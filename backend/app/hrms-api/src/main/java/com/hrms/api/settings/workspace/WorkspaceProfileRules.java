package com.hrms.api.settings.workspace;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Checks for the workspace profile (Settings -> Profile -> Organisation).
 * Pure functions so they can be unit tested; the messages are what the page
 * shows under each field.
 */
public final class WorkspaceProfileRules {

    private WorkspaceProfileRules() {}

    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$");
    private static final Pattern PHONE = Pattern.compile("^\\+?[\\d\\s()-]{7,20}$");
    private static final Pattern PIN = Pattern.compile("^[1-9][0-9]{5}$");
    private static final Pattern PAN = Pattern.compile("^[A-Z]{5}[0-9]{4}[A-Z]$");
    private static final Pattern GSTIN = Pattern.compile("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$");
    private static final String B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    public record Profile(String displayName, String contactEmail, String contactPhone,
                          String addressLine1, String addressLine2, String city, String state,
                          String postalCode, String gstin, String pan) {}

    /** Trim everything, blank to null, upper-case the tax ids. */
    public static Profile normalize(Profile p) {
        return new Profile(clean(p.displayName()), clean(p.contactEmail()), clean(p.contactPhone()),
                clean(p.addressLine1()), clean(p.addressLine2()), clean(p.city()), clean(p.state()),
                clean(p.postalCode()), upper(p.gstin()), upper(p.pan()));
    }

    /** Field -> message for every problem; empty when the profile can be saved. */
    public static Map<String, String> validate(Profile p) {
        Map<String, String> e = new LinkedHashMap<>();
        if (p.displayName() == null || p.displayName().length() < 2) e.put("displayName", "Enter the workspace name (at least 2 characters).");
        else if (p.displayName().length() > 150) e.put("displayName", "Keep the name to 150 characters.");
        if (p.contactEmail() != null && (p.contactEmail().length() > 255 || !EMAIL.matcher(p.contactEmail()).matches())) e.put("contactEmail", "Enter an email address like accounts@company.com.");
        if (p.contactPhone() != null && (p.contactPhone().length() > 20 || !PHONE.matcher(p.contactPhone()).matches())) e.put("contactPhone", "Enter a phone number (digits, spaces, + and - only).");
        if (p.addressLine1() != null && p.addressLine1().length() > 255) e.put("addressLine1", "Keep this line to 255 characters.");
        if (p.addressLine2() != null && p.addressLine2().length() > 255) e.put("addressLine2", "Keep this line to 255 characters.");
        if (p.city() != null && p.city().length() > 100) e.put("city", "Keep the city to 100 characters.");
        if (p.state() != null && p.state().length() > 100) e.put("state", "Keep the state to 100 characters.");
        if (p.postalCode() != null && !PIN.matcher(p.postalCode()).matches()) e.put("postalCode", "Enter a 6-digit PIN code.");
        if (p.pan() != null && !PAN.matcher(p.pan()).matches()) e.put("pan", "Enter a PAN like ABCDE1234F.");
        if (p.gstin() != null) {
            if (!GSTIN.matcher(p.gstin()).matches()) e.put("gstin", "Enter a 15-character GSTIN like 27ABCDE1234F1Z5.");
            else if (!gstinChecksumOk(p.gstin())) e.put("gstin", "This GSTIN's last character doesn't match. Check it for typos.");
            else if (p.pan() != null && PAN.matcher(p.pan()).matches() && !p.gstin().substring(2, 12).equals(p.pan())) {
                e.put("gstin", "Characters 3 to 12 of the GSTIN must be the PAN (" + p.pan() + ").");
            }
        }
        return e;
    }

    /** GSTIN check character (mod-36, alternating weights 1 and 2). */
    static boolean gstinChecksumOk(String g) {
        int sum = 0;
        for (int i = 0; i < 14; i++) {
            int v = B36.indexOf(g.charAt(i));
            if (v < 0) return false;
            int prod = v * (i % 2 == 0 ? 1 : 2);
            sum += prod / 36 + prod % 36;
        }
        return B36.charAt((36 - sum % 36) % 36) == g.charAt(14);
    }

    private static String clean(String s) {
        if (s == null) return null;
        String t = s.trim().replaceAll("\\s+", " ");
        return t.isEmpty() ? null : t;
    }

    private static String upper(String s) {
        String c = clean(s);
        return c == null ? null : c.replace(" ", "").toUpperCase(Locale.ROOT);
    }
}
