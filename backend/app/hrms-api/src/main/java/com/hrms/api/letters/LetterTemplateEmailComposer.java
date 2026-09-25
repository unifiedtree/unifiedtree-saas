package com.hrms.api.letters;

import com.hrms.letters.domain.GeneratedLetter;
import com.hrms.letters.service.LetterEmailComposer;
import com.unifiedtree.notifications.template.NotificationEmailComposer;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * Words the email a single generated letter is sent in with the company's
 * "letters.letter" template: the admin's message first, then the letter
 * itself (it is also attached as a PDF). With no active template the letter
 * goes out on its own, as before. Letters are always sent: HR chose to send it.
 */
@Component
public class LetterTemplateEmailComposer implements LetterEmailComposer {

    private final NotificationEmailComposer composer;

    public LetterTemplateEmailComposer(NotificationEmailComposer composer) {
        this.composer = composer;
    }

    @Override
    public Content compose(GeneratedLetter letter) {
        Map<String, String> ctx = letter.getGenerationContext() == null ? Map.of() : letter.getGenerationContext();
        Map<String, String> values = new HashMap<>();
        String first = nz(ctx.get("employee.firstName"));
        values.put("firstName", first.isBlank() ? "there" : first);
        values.put("employeeName", nz(ctx.get("employee.fullName")).trim());
        values.put("letterSubject", nz(letter.getSubject()));
        values.put("companyName", nz(ctx.getOrDefault("company.legalName", ctx.get("company.name"))));
        var email = composer.compose(letter.getTenantId(), letter.getCompanyId(), "letters.letter", values,
                letter.getSubject(), letter.getBodyHtmlRendered());
        if (!email.templated()) return null;
        String letterHtml = letter.getBodyHtmlRendered() == null ? "" : letter.getBodyHtmlRendered();
        return new Content(email.subject(), email.html() + "<hr />" + letterHtml);
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
