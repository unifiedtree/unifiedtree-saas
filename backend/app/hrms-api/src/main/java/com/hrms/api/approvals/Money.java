package com.hrms.api.approvals;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Locale;

/**
 * Amounts on approval lines: "₹4,860", "₹1,20,000.50", "USD 12.50". Rupees
 * use Indian grouping (lakhs), which java.text formats can't produce.
 */
public final class Money {

    private Money() {
    }

    public static String format(String currency, BigDecimal amount) {
        if (amount == null) return "";
        BigDecimal value = amount.setScale(2, RoundingMode.HALF_UP);
        boolean negative = value.signum() < 0;
        String plain = value.abs().toPlainString();
        String whole = plain.substring(0, plain.indexOf('.'));
        String fraction = plain.substring(plain.indexOf('.') + 1);
        String code = currency == null || currency.isBlank() ? "INR" : currency.trim().toUpperCase(Locale.ROOT);
        boolean inr = "INR".equals(code);
        String grouped = inr ? indian(whole) : western(whole);
        String number = (negative ? "-" : "") + grouped + ("00".equals(fraction) ? "" : "." + fraction);
        return inr ? "₹" + number : code + " " + number;
    }

    /** 1234567 → 12,34,567. */
    static String indian(String digits) {
        if (digits.length() <= 3) return digits;
        String last3 = digits.substring(digits.length() - 3);
        String rest = digits.substring(0, digits.length() - 3);
        StringBuilder out = new StringBuilder();
        int first = rest.length() % 2;
        if (first > 0) out.append(rest, 0, first);
        for (int i = first; i < rest.length(); i += 2) {
            if (!out.isEmpty()) out.append(',');
            out.append(rest, i, i + 2);
        }
        return out.append(',').append(last3).toString();
    }

    /** 1234567 → 1,234,567. */
    static String western(String digits) {
        StringBuilder out = new StringBuilder();
        int first = digits.length() % 3;
        if (first > 0) out.append(digits, 0, first);
        for (int i = first; i < digits.length(); i += 3) {
            if (!out.isEmpty()) out.append(',');
            out.append(digits, i, i + 3);
        }
        return out.toString();
    }
}
