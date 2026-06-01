package com.hrms.letters.service;

import com.hrms.letters.LettersModuleConfig;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

@Service
public class LetterEmailService {

    private static final Logger log = LoggerFactory.getLogger(LetterEmailService.class);

    private final JavaMailSender mailSender;
    private final String fromEmail;
    private final String fromName;

    public LetterEmailService(JavaMailSender mailSender,
                              LettersModuleConfig.LettersProperties props) {
        this.mailSender = mailSender;
        this.fromEmail  = props.fromEmail();
        this.fromName   = props.fromName();
    }

    public void send(String toEmail, String ccEmail,
                     String subject, String bodyHtml,
                     byte[] pdfBytes, String filename) {
        try {
            MimeMessage msg = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg, true, "UTF-8");
            helper.setFrom(fromEmail, fromName);
            helper.setTo(toEmail);
            if (ccEmail != null && !ccEmail.isBlank()) {
                helper.setCc(ccEmail);
            }
            helper.setSubject(subject);
            helper.setText(bodyHtml, true);
            if (pdfBytes != null && pdfBytes.length > 0) {
                helper.addAttachment(filename, () -> new java.io.ByteArrayInputStream(pdfBytes), "application/pdf");
            }
            mailSender.send(msg);
            log.info("Letter emailed to {}: {}", toEmail, subject);
        } catch (MessagingException | java.io.UnsupportedEncodingException e) {
            throw new RuntimeException("Failed to send letter email to " + toEmail, e);
        }
    }
}
