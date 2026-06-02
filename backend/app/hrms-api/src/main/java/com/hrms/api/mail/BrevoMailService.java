package com.hrms.api.mail;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;

/**
 * Brevo (formerly Sendinblue) transactional email via REST API.
 *
 * <p>Active when {@code unifiedtree.mail.provider=brevo}.
 * No SDK dependency — uses the standard Java 11+ {@link HttpClient}.
 *
 * <p>Required env vars:
 * <pre>
 *   BREVO_API_KEY=xkeysib-...
 *   MAIL_FROM_EMAIL=chakridol143@gmail.com   (verified sender in Brevo)
 *   MAIL_FROM_NAME=UnifiedTree
 * </pre>
 */
@Service
@ConditionalOnProperty(name = "unifiedtree.mail.provider", havingValue = "brevo")
public class BrevoMailService implements MailService {

    private static final Logger log = LoggerFactory.getLogger(BrevoMailService.class);
    private static final String BREVO_API = "https://api.brevo.com/v3/smtp/email";

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${BREVO_API_KEY:}")
    private String apiKey;

    @Value("${unifiedtree.mail.from-email:noreply@unifiedtree.com}")
    private String fromEmail;

    @Value("${unifiedtree.mail.from-name:UnifiedTree}")
    private String fromName;

    @Override
    public void send(EmailMessage msg) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new MailDeliveryException("BREVO_API_KEY is not set. Cannot send email.", null);
        }

        Map<String, Object> to = new LinkedHashMap<>();
        to.put("email", msg.to());
        if (msg.toName() != null) to.put("name", msg.toName());

        Map<String, Object> sender = Map.of("name", fromName, "email", fromEmail);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("sender", sender);
        payload.put("to", List.of(to));
        payload.put("subject", msg.subject());
        if (msg.htmlBody() != null) payload.put("htmlContent", msg.htmlBody());
        if (msg.textBody() != null) payload.put("textContent", msg.textBody());
        if (msg.cc() != null && !msg.cc().isEmpty()) {
            payload.put("cc", msg.cc().stream().map(cc -> Map.of("email", cc)).toList());
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
                throw new MailDeliveryException(
                    "Brevo API error " + resp.statusCode() + " sending to " + msg.to() + ": " + resp.body(), null);
            }
            log.info("Brevo email sent to {}: {} (status {})", msg.to(), msg.subject(), resp.statusCode());
        } catch (MailDeliveryException e) {
            throw e;
        } catch (Exception e) {
            throw new MailDeliveryException("Brevo send failed to " + msg.to(), e);
        }
    }
}
