package com.hrms.api.approvals;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.NumberFormat;
import java.util.Locale;

/** Amounts on approval lines: "₹4,860", "₹1,20,000.50", "USD 12.50". */
public final class Money {

    private static final Locale INDIA = Locale.forLanguageTag("en-IN");

    private Money() {
    }

    public static String format(String currency, BigDecimal amount) {
        if (amount == null) return "";
        BigDecimal value = amount.setScale(2, RoundingMode.HALF_UP);
        boolean whole = value.stripTrailingZeros().scale() <= 0;
        NumberFormat f = NumberFormat.getNumberInstance(INDIA);
        f.setMinimumFractionDigits(whole ? 0 : 2);
        f.setMaximumFractionDigits(whole ? 0 : 2);
        String number = f.format(value);
        String code = currency == null || currency.isBlank() ? "INR" : currency.trim().toUpperCase(Locale.ROOT);
        return "INR".equals(code) ? "₹" + number : code + " " + number;
    }
}
