package com.hrms.app.reports;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import org.jsoup.Jsoup;
import org.jsoup.helper.W3CDom;

import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Set;

/**
 * A small HTML builder for report PDFs, laid out like the report pages: a
 * title block, four KPI cards, bar charts and a table with a totals row.
 *
 * <p>Everything is plain tables and blocks (the PDF engine has no flexbox),
 * every value is escaped, and the page is parsed by jsoup into a W3C document
 * before rendering, so any character a name or filter carries is safe. The
 * PDF's built-in fonts have no rupee sign, so money is never written with one.
 * No product name appears anywhere: the page carries the company's name.
 */
final class ReportHtml {

    static final String GREEN = "#0f6e56";
    static final String MINT = "#34d399";
    static final String PALE = "#a7f3d0";

    record Kpi(String label, String value, String sub) {}
    /** One bar: a label, its stacked parts (in legend order) and the value shown at its end. */
    record Bar(String label, List<Double> parts, String shown, boolean muted) {}
    record Legend(String label, String color) {}

    private final StringBuilder body = new StringBuilder();
    private final String title;
    private final String footer;
    private final boolean landscape;

    ReportHtml(String title, String subtitle, String generated, String footer, boolean landscape) {
        this.title = title;
        this.footer = footer;
        this.landscape = landscape;
        body.append("<h1>").append(esc(title)).append("</h1>")
            .append("<div class=\"muted\">").append(esc(subtitle)).append("</div>")
            .append("<div class=\"gen\">").append(esc(generated)).append("</div>");
    }

    ReportHtml kpis(List<Kpi> kpis) {
        if (kpis.isEmpty()) return this;
        body.append("<table class=\"kpis\"><tr>");
        for (Kpi k : kpis) {
            body.append("<td><div class=\"kl\">").append(esc(k.label())).append("</div>")
                .append("<div class=\"kv\">").append(esc(k.value())).append("</div>")
                .append("<div class=\"ks\">").append(esc(k.sub())).append("</div></td>");
        }
        body.append("</tr></table>");
        return this;
    }

    /** Horizontal stacked bars, scaled to the longest one. */
    ReportHtml bars(String heading, String aside, List<Legend> legend, List<Bar> bars) {
        body.append("<div class=\"card\"><h2>").append(esc(heading));
        if (aside != null && !aside.isBlank()) body.append(" <span class=\"aside\">").append(esc(aside)).append("</span>");
        body.append("</h2>");
        if (legend.size() > 1) {
            body.append("<div class=\"legend\">");
            for (Legend l : legend) {
                body.append("<span class=\"sw\" style=\"background:").append(l.color()).append("\">&#160;&#160;&#160;</span> ")
                    .append(esc(l.label())).append("&#160;&#160;&#160;&#160;");
            }
            body.append("</div>");
        }
        if (bars.isEmpty()) {
            body.append("<div class=\"muted\">Nothing to show for this period.</div></div>");
            return this;
        }
        double max = bars.stream().mapToDouble(b -> b.parts().stream().mapToDouble(Double::doubleValue).sum()).max().orElse(0);
        body.append("<table class=\"bars\">");
        for (Bar b : bars) {
            double sum = b.parts().stream().mapToDouble(Double::doubleValue).sum();
            double width = max > 0 ? Math.max(0.6, sum / max * 100.0) : 0;
            body.append("<tr><td class=\"bl").append(b.muted() ? " mutedtxt" : "").append("\">").append(esc(b.label())).append("</td><td class=\"bt\">");
            if (sum > 0) {
                body.append("<table class=\"stack\" style=\"width:").append(pct(width)).append("\"><tr>");
                for (int i = 0; i < b.parts().size(); i++) {
                    double v = b.parts().get(i);
                    if (v <= 0) continue;
                    String color = i < legend.size() ? legend.get(i).color() : GREEN;
                    body.append("<td style=\"width:").append(pct(v / sum * 100.0)).append(";background:").append(color).append("\">&#160;</td>");
                }
                body.append("</tr></table>");
            }
            body.append("</td><td class=\"bv\">").append(esc(b.shown())).append("</td></tr>");
        }
        body.append("</table></div>");
        return this;
    }

    /** A table; {@code numeric} are the column indexes aligned right. */
    ReportHtml table(String heading, List<String> head, List<List<Object>> rows, List<Object> foot, Set<Integer> numeric) {
        body.append("<div class=\"card\"><h2>").append(esc(heading))
            .append(" <span class=\"aside\">").append(rows.size()).append(rows.size() == 1 ? " row" : " rows").append("</span></h2>");
        if (rows.isEmpty()) {
            body.append("<div class=\"muted\">No rows for these filters.</div></div>");
            return this;
        }
        body.append("<table class=\"t\"><thead><tr>");
        for (int i = 0; i < head.size(); i++) body.append("<th").append(numeric.contains(i) ? " class=\"n\"" : "").append(">").append(esc(head.get(i))).append("</th>");
        body.append("</tr></thead><tbody>");
        for (List<Object> r : rows) {
            body.append("<tr>");
            for (int i = 0; i < r.size(); i++) body.append("<td").append(numeric.contains(i) ? " class=\"n\"" : "").append(">").append(cell(r.get(i))).append("</td>");
            body.append("</tr>");
        }
        body.append("</tbody>");
        if (foot != null && !foot.isEmpty()) {
            body.append("<tfoot><tr>");
            for (int i = 0; i < foot.size(); i++) body.append("<td").append(numeric.contains(i) ? " class=\"n\"" : "").append(">").append(cell(foot.get(i))).append("</td>");
            body.append("</tr></tfoot>");
        }
        body.append("</table></div>");
        return this;
    }

    ReportHtml note(String text) {
        body.append("<div class=\"note\">").append(esc(text)).append("</div>");
        return this;
    }

    String html() {
        String css = """
                @page { size: A4%s; margin: 14mm 12mm 16mm 12mm;
                  @bottom-left { content: "%s"; font-family: sans-serif; font-size: 7.5pt; color: #64748b; }
                  @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: sans-serif; font-size: 7.5pt; color: #64748b; } }
                body { font-family: sans-serif; font-size: 9pt; color: #0f172a; }
                h1 { font-size: 17pt; margin: 0 0 3pt 0; color: #0f172a; }
                h2 { font-size: 11pt; margin: 0 0 8pt 0; }
                .muted { color: #64748b; font-size: 9pt; }
                .mutedtxt { color: #64748b; font-style: italic; }
                .gen { color: #94a3b8; font-size: 8pt; margin: 2pt 0 10pt 0; }
                .aside { color: #64748b; font-size: 8.5pt; font-weight: normal; }
                .kpis { width: 100%%; border-collapse: separate; border-spacing: 6pt 0; margin: 0 -6pt 10pt -6pt; table-layout: fixed; }
                .kpis td { border: 1px solid #e2e8f0; border-radius: 8pt; padding: 7pt 9pt; vertical-align: top; }
                .kl { color: #64748b; font-size: 8pt; }
                .kv { font-size: 15pt; font-weight: bold; margin: 2pt 0; color: #0f172a; }
                .ks { color: #64748b; font-size: 7.5pt; }
                .card { border: 1px solid #e2e8f0; border-radius: 10pt; padding: 10pt 12pt; margin: 0 0 10pt 0; }
                .legend { font-size: 8pt; color: #334155; margin: -2pt 0 8pt 0; }
                .sw { font-size: 7pt; }
                .bars { width: 100%%; border-collapse: collapse; table-layout: fixed; }
                .bars td { padding: 2.5pt 0; vertical-align: middle; }
                .bl { width: 30%%; padding-right: 8pt !important; font-size: 8.5pt; color: #334155; }
                .bt { width: 58%%; }
                .bv { width: 12%%; padding-left: 6pt !important; font-weight: bold; font-size: 8.5pt; }
                .stack { border-collapse: collapse; table-layout: fixed; height: 9pt; }
                .stack td { padding: 0; height: 9pt; font-size: 5pt; line-height: 9pt; }
                .t { width: 100%%; border-collapse: collapse; -fs-table-paginate: paginate; }
                .t th { background: #f8fafc; font-weight: bold; text-align: left; padding: 4pt 5pt; border-bottom: 1px solid #e2e8f0; font-size: 8pt; color: #475569; }
                .t td { padding: 4pt 5pt; border-bottom: 1px solid #f1f5f9; font-size: 8.5pt; }
                .t tr { page-break-inside: avoid; }
                .t .n { text-align: right; }
                .t tfoot td { font-weight: bold; border-top: 1.5px solid #cbd5e1; border-bottom: 0; }
                .note { color: #64748b; font-size: 8pt; margin: 4pt 0 0 0; }
                """.formatted(landscape ? " landscape" : "", cssString(footer));
        return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/><title>" + esc(title) + "</title><style>" + css
                + "</style></head><body>" + body + "</body></html>";
    }

    /** Renders the page to PDF bytes. */
    byte[] pdf() {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            org.w3c.dom.Document doc = new W3CDom().fromJsoup(Jsoup.parse(html()));
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFastMode();
            builder.withW3cDocument(doc, "/");
            builder.toStream(out);
            builder.run();
            return out.toByteArray();
        } catch (Exception e) {
            throw new IllegalStateException("Could not render the report PDF: " + e.getMessage(), e);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    static String esc(Object v) {
        if (v == null) return "";
        String s = String.valueOf(v);
        StringBuilder out = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                case '\'' -> out.append("&#39;");
                default -> {
                    // Control characters can't appear in the document.
                    if (c < 0x20 && c != '\n' && c != '\t') continue;
                    out.append(c);
                }
            }
        }
        return out.toString();
    }

    private static String cell(Object v) {
        return v == null || (v instanceof String s && s.isBlank()) ? "&#8212;" : esc(v);
    }

    /** A CSS string literal body: quotes and backslashes escaped, no line breaks. */
    static String cssString(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replaceAll("[\\r\\n<>]", " ");
    }

    private static String pct(double v) {
        return String.format(java.util.Locale.ROOT, "%.2f%%", Math.max(0, Math.min(100, v)));
    }
}
