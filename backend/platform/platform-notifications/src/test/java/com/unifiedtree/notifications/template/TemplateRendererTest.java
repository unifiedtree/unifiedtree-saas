package com.unifiedtree.notifications.template;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TemplateRendererTest {

    private static final NotificationEventCatalog.EventDef INVITE =
            NotificationEventCatalog.byKey("account.invitation").orElseThrow();
    private static final NotificationEventCatalog.EventDef DISTRIBUTION =
            NotificationEventCatalog.byKey("letters.distribution").orElseThrow();

    @Test
    void fillsPlaceholdersWithOrWithoutSpaces() {
        String out = TemplateRenderer.render("Hi {{firstName}}, welcome to {{ workspaceName }}.",
                Map.of("firstName", "Asha", "workspaceName", "Acme"));
        assertEquals("Hi Asha, welcome to Acme.", out);
    }

    @Test
    void missingOrUnknownPlaceholdersRenderAsNothing() {
        Map<String, String> v = new HashMap<>();
        v.put("firstName", null);
        assertEquals("Hi , see .", TemplateRenderer.render("Hi {{firstName}}, see {{unknownThing}}.", v));
        assertEquals("Hi .", TemplateRenderer.render("Hi {{firstName}}.", null));
    }

    @Test
    void textThatIsNotAPlaceholderIsLeftAlone() {
        assertEquals("{{ 1bad }} and {single} and {{}}",
                TemplateRenderer.render("{{ 1bad }} and {single} and {{}}", Map.of()));
        assertNull(TemplateRenderer.render(null, Map.of()));
    }

    @Test
    void valuesAreNotExpandedAgainAndSpecialCharactersSurvive() {
        String out = TemplateRenderer.render("{{a}} / {{b}}", Map.of("a", "{{b}}", "b", "$1 \\ cost"));
        assertEquals("{{b}} / $1 \\ cost", out);
    }

    @Test
    void subjectFoldsLineBreaks() {
        assertEquals("Hello Asha there", TemplateRenderer.renderSubject("Hello {{n}}\r\nthere", Map.of("n", "Asha")));
    }

    @Test
    void emailEscapesTemplateTextAndValues() {
        String html = TemplateRenderer.renderEmailHtml(
                "Hi {{firstName}} <b>&</b>", Map.of("firstName", "<script>alert(1)</script>"), INVITE);
        assertFalse(html.contains("<script>"), html);
        assertFalse(html.contains("<b>"), html);
        assertTrue(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"), html);
        assertTrue(html.contains("&lt;b&gt;&amp;&lt;/b&gt;"), html);
    }

    @Test
    void emailTurnsBlankLinesIntoParagraphsAndNewlinesIntoBreaks() {
        String html = TemplateRenderer.renderEmailHtml("Line one\nline two\n\nNext paragraph", Map.of(), INVITE);
        assertTrue(html.contains("<p>Line one<br>line two</p><p>Next paragraph</p>"), html);
    }

    @Test
    void emailLinksOnlyHttpUrlsInLinkPlaceholders() {
        String html = TemplateRenderer.renderEmailHtml("Open {{inviteLink}}",
                Map.of("inviteLink", "https://acme.example/accept?token=a&b=\"c\""), INVITE);
        assertTrue(html.contains("<a href=\"https://acme.example/accept?token=a&amp;b=&quot;c&quot;\""), html);

        String js = TemplateRenderer.renderEmailHtml("Open {{inviteLink}}", Map.of("inviteLink", "javascript:alert(1)"), INVITE);
        assertFalse(js.contains("<a "), js);
        assertTrue(js.contains("javascript:alert(1)"), js);

        // A non-link placeholder holding a URL stays plain text.
        String plain = TemplateRenderer.renderEmailHtml("{{firstName}}", Map.of("firstName", "https://x.example"), INVITE);
        assertFalse(plain.contains("<a "), plain);
    }

    @Test
    void emailInsertsPreSanitisedHtmlPlaceholdersAsTheyAre() {
        String html = TemplateRenderer.renderEmailHtml("Hi\n\n{{message}}", Map.of("message", "<b>Welcome</b>"), DISTRIBUTION);
        assertTrue(html.contains("<b>Welcome</b>"), html);
    }

    @Test
    void emailWithoutEventTreatsEveryValueAsText() {
        String html = TemplateRenderer.renderEmailHtml("{{message}}", Map.of("message", "<b>x</b>"), null);
        assertTrue(html.contains("&lt;b&gt;x&lt;/b&gt;"), html);
    }

    @Test
    void listsPlaceholdersInOrder() {
        assertEquals(List.of("a", "b"), List.copyOf(TemplateRenderer.placeholders("{{a}} {{ b }} {{a}}")));
        assertTrue(TemplateRenderer.placeholders(null).isEmpty());
    }

    @Test
    void escapeHtmlCoversQuotes() {
        assertEquals("&lt;a href=&quot;x&quot;&gt;&#39;&amp;", TemplateRenderer.escapeHtml("<a href=\"x\">'&"));
        assertEquals("", TemplateRenderer.escapeHtml(null));
    }
}
