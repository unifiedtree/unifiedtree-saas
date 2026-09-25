package com.unifiedtree.notifications.template;

import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Fills {@code {{placeholders}}} in notification template text.
 *
 * <p>Rules, all covered by {@code TemplateRendererTest}:
 * <ul>
 *   <li>{@code {{name}}} and {@code {{ name }}} are the same placeholder.</li>
 *   <li>A placeholder with no value (unknown name, or a null value) renders as
 *       nothing, never as the raw {@code {{name}}} text a recipient would find
 *       confusing. Template saves are checked against the event's placeholder
 *       list, so an unknown name only reaches here from an old template.</li>
 *   <li>Values are inserted once, in a single pass: a value that itself
 *       contains {@code {{…}}} is not expanded again.</li>
 *   <li>{@link #renderEmailHtml} treats the template as plain text: the
 *       template's own text AND every value are HTML-escaped, blank lines make
 *       paragraphs and single newlines become line breaks. Link placeholders
 *       holding an http(s) URL become clickable links; placeholders marked
 *       {@code html} (already-sanitised HTML from the sender) go in as they are.</li>
 * </ul>
 */
public final class TemplateRenderer {

    /** {{ name }} — letters, digits and underscores, starting with a letter. */
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{\\s*([A-Za-z][A-Za-z0-9_]*)\\s*\\}\\}");

    private static final String LINK_STYLE = "color:#0f6e56;font-weight:600";
    private static final String WRAPPER_OPEN =
            "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;line-height:1.5\">";

    private TemplateRenderer() {}

    /** Plain-text render (subjects, in-app and push text). Missing values render as nothing. */
    public static String render(String template, Map<String, String> values) {
        if (template == null) return null;
        Matcher m = PLACEHOLDER.matcher(template);
        StringBuilder out = new StringBuilder(template.length() + 32);
        while (m.find()) {
            String v = values == null ? null : values.get(m.group(1));
            m.appendReplacement(out, Matcher.quoteReplacement(v == null ? "" : v));
        }
        m.appendTail(out);
        return out.toString();
    }

    /** A one-line subject: rendered, with line breaks folded to spaces (mail headers can't carry them). */
    public static String renderSubject(String template, Map<String, String> values) {
        String s = render(template, values);
        return s == null ? null : s.replaceAll("[\\r\\n]+", " ").trim();
    }

    /**
     * Renders a plain-text template as a safe HTML email body (see class notes).
     *
     * @param def the event, for which placeholders are links or pre-sanitised HTML; may be null
     */
    public static String renderEmailHtml(String template, Map<String, String> values, NotificationEventCatalog.EventDef def) {
        if (template == null) return null;
        String text = template.replace("\r\n", "\n").replace('\r', '\n').strip();
        Matcher m = PLACEHOLDER.matcher(text);
        StringBuilder out = new StringBuilder(text.length() + 64);
        int last = 0;
        while (m.find()) {
            out.append(escapeText(text.substring(last, m.start())));
            String name = m.group(1);
            String v = values == null ? null : values.get(name);
            NotificationEventCatalog.Placeholder p = def == null ? null : def.placeholder(name);
            out.append(htmlValue(v, p));
            last = m.end();
        }
        out.append(escapeText(text.substring(last)));
        return wrap("<p>" + out + "</p>");
    }

    /** Wraps already-safe HTML paragraphs in the neutral email container. */
    public static String wrap(String paragraphsHtml) {
        return WRAPPER_OPEN + paragraphsHtml + "</div>";
    }

    /** Names of the placeholders a template uses, in order of first appearance. */
    public static Set<String> placeholders(String template) {
        Set<String> names = new LinkedHashSet<>();
        if (template == null) return names;
        Matcher m = PLACEHOLDER.matcher(template);
        while (m.find()) names.add(m.group(1));
        return names;
    }

    /** HTML-escapes text for element content and double-quoted attributes. */
    public static String escapeHtml(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '&' -> b.append("&amp;");
                case '<' -> b.append("&lt;");
                case '>' -> b.append("&gt;");
                case '"' -> b.append("&quot;");
                case '\'' -> b.append("&#39;");
                default -> b.append(c);
            }
        }
        return b.toString();
    }

    /** Plain text → escaped HTML with paragraphs (blank line) and line breaks (newline). */
    public static String paragraphs(String plain) {
        if (plain == null || plain.isBlank()) return "";
        String text = plain.replace("\r\n", "\n").replace('\r', '\n').strip();
        return "<p>" + escapeText(text) + "</p>";
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /** Escapes a literal stretch of template text and turns its newlines into paragraph/line breaks. */
    private static String escapeText(String s) {
        return escapeHtml(s).replaceAll("\n\\s*\n", "</p><p>").replace("\n", "<br>");
    }

    private static String htmlValue(String v, NotificationEventCatalog.Placeholder p) {
        if (v == null || v.isEmpty()) return "";
        if (p != null && p.html()) return v;
        String escaped = escapeHtml(v).replace("\n", "<br>");
        if (p != null && p.link() && (v.startsWith("https://") || v.startsWith("http://"))) {
            return "<a href=\"" + escapeHtml(v) + "\" style=\"" + LINK_STYLE + "\">" + escaped + "</a>";
        }
        return escaped;
    }
}
