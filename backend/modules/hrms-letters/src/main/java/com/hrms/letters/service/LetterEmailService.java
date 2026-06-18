package com.hrms.letters.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;

/**
 * Sends letter emails via Brevo REST API (HTTPS/443 — works on Railway).
 * Falls back to a clear error if BREVO_API_KEY is absent.
 */
@Service
public class LetterEmailService {

    private static final Logger log = LoggerFactory.getLogger(LetterEmailService.class);
    private static final String BREVO_API = "https://api.brevo.com/v3/smtp/email";

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${BREVO_API_KEY:}")
    private String apiKey;

    @Value("${unifiedtree.mail.from-email:${MAIL_FROM_EMAIL:noreply@unifiedtree.com}}")
    private String fromEmail;

    @Value("${unifiedtree.mail.from-name:${MAIL_FROM_NAME:UnifiedTree}}")
    private String fromName;

    public void send(String toEmail, String ccEmail,
                     String subject, String bodyHtml,
                     byte[] pdfBytes, String filename) {

        if (apiKey == null || apiKey.isBlank()) {
            throw new RuntimeException("BREVO_API_KEY is not configured — cannot send letter email");
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("sender", Map.of("name", fromName, "email", fromEmail));
        payload.put("to", List.of(Map.of("email", toEmail)));
        payload.put("subject", subject);
        payload.put("htmlContent", bodyHtml != null ? bodyHtml : "");

        if (ccEmail != null && !ccEmail.isBlank()) {
            payload.put("cc", List.of(Map.of("email", ccEmail)));
        }

        if (pdfBytes != null && pdfBytes.length > 0) {
            String encoded = Base64.getEncoder().encodeToString(pdfBytes);
            payload.put("attachment", List.of(Map.of(
                    "content", encoded,
                    "name", filename != null ? filename : "letter.pdf")));
        }

        try {
            String body = mapper.writeValueAsString(payload);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(BREVO_API))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .header("api-key", apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
                throw new RuntimeException(
                        "Brevo API error " + resp.statusCode() + " sending to " + toEmail + ": " + resp.body());
            }
            log.info("Letter email sent via Brevo to {} subject='{}' status={}", toEmail, subject, resp.statusCode());
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to send letter email to " + toEmail, e);
        }
    }
}
