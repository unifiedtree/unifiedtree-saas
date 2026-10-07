package com.unifiedtree.saas.billing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/** Indian GST facts the billing code needs: GSTIN shape, state codes, and the CGST + SGST / IGST split. */
public final class Gst {

    private Gst() {}

    /** 2-digit state, 10-character PAN, entity number, 'Z', check character. */
    public static final Pattern GSTIN = Pattern.compile("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$");
    public static final Pattern PAN = Pattern.compile("^[A-Z]{5}[0-9]{4}[A-Z]$");
    public static final Pattern STATE_CODE = Pattern.compile("^[0-9]{2}$");

    /** Trimmed, upper-cased, null when blank. */
    public static String normalise(String v) {
        if (v == null || v.isBlank()) return null;
        return v.strip().toUpperCase(Locale.ROOT);
    }

    public static boolean validGstin(String gstin) {
        return gstin != null && GSTIN.matcher(gstin).matches() && STATE_NAMES.containsKey(gstin.substring(0, 2));
    }

    /** The GSTIN's state code, only when the GSTIN is well formed (never from a malformed one). */
    public static String stateOfGstin(String gstin) {
        return validGstin(gstin) ? gstin.substring(0, 2) : null;
    }

    public static boolean knownStateCode(String code) {
        return code != null && STATE_NAMES.containsKey(code);
    }

    /** A state's GST code from its name as people type it ("Tamil Nadu", "telangana", "NCT of Delhi"), or a code. */
    public static String stateCode(String nameOrCode) {
        if (nameOrCode == null || nameOrCode.isBlank()) return null;
        String s = nameOrCode.strip();
        if (STATE_CODE.matcher(s).matches()) return knownStateCode(s) ? s : null;
        return BY_NAME.get(key(s));
    }

    /**
     * Split one line's GST: inside one state CGST + SGST (half each, the odd paisa to CGST), across
     * states IGST. Returns {cgst, sgst, igst}; they always add up to {@code tax}.
     */
    public static BigDecimal[] split(BigDecimal tax, boolean intraState) {
        BigDecimal t = tax.setScale(2, RoundingMode.HALF_UP);
        if (!intraState) return new BigDecimal[] {zero(), zero(), t};
        BigDecimal cgst = t.divide(BigDecimal.valueOf(2), 2, RoundingMode.HALF_UP);
        return new BigDecimal[] {cgst, t.subtract(cgst), zero()};
    }

    private static BigDecimal zero() {
        return BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP);
    }

    private static String key(String name) {
        return name.toLowerCase(Locale.ROOT).replace("&", "and").replaceAll("[^a-z]", "");
    }

    /** GST state and union-territory codes (CBIC). */
    static final Map<String, String> STATE_NAMES = Map.ofEntries(
            Map.entry("01", "Jammu and Kashmir"), Map.entry("02", "Himachal Pradesh"), Map.entry("03", "Punjab"),
            Map.entry("04", "Chandigarh"), Map.entry("05", "Uttarakhand"), Map.entry("06", "Haryana"),
            Map.entry("07", "Delhi"), Map.entry("08", "Rajasthan"), Map.entry("09", "Uttar Pradesh"),
            Map.entry("10", "Bihar"), Map.entry("11", "Sikkim"), Map.entry("12", "Arunachal Pradesh"),
            Map.entry("13", "Nagaland"), Map.entry("14", "Manipur"), Map.entry("15", "Mizoram"),
            Map.entry("16", "Tripura"), Map.entry("17", "Meghalaya"), Map.entry("18", "Assam"),
            Map.entry("19", "West Bengal"), Map.entry("20", "Jharkhand"), Map.entry("21", "Odisha"),
            Map.entry("22", "Chhattisgarh"), Map.entry("23", "Madhya Pradesh"), Map.entry("24", "Gujarat"),
            Map.entry("26", "Dadra and Nagar Haveli and Daman and Diu"), Map.entry("27", "Maharashtra"),
            Map.entry("29", "Karnataka"), Map.entry("30", "Goa"), Map.entry("31", "Lakshadweep"),
            Map.entry("32", "Kerala"), Map.entry("33", "Tamil Nadu"), Map.entry("34", "Puducherry"),
            Map.entry("35", "Andaman and Nicobar Islands"), Map.entry("36", "Telangana"),
            Map.entry("37", "Andhra Pradesh"), Map.entry("38", "Ladakh"), Map.entry("97", "Other Territory"));

    private static final Map<String, String> BY_NAME = new HashMap<>();
    static {
        STATE_NAMES.forEach((code, name) -> BY_NAME.put(key(name), code));
        BY_NAME.put(key("New Delhi"), "07");
        BY_NAME.put(key("NCT of Delhi"), "07");
        BY_NAME.put(key("Orissa"), "21");
        BY_NAME.put(key("Uttaranchal"), "05");
        BY_NAME.put(key("Pondicherry"), "34");
        BY_NAME.put(key("Daman and Diu"), "26");
        BY_NAME.put(key("Dadra and Nagar Haveli"), "26");
        BY_NAME.put(key("Andaman and Nicobar"), "35");
        BY_NAME.put(key("J&K"), "01");
    }
}
