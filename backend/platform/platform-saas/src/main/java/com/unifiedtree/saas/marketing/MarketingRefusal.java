package com.unifiedtree.saas.marketing;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * A refusal from the Marketing internal / SSO API with a stable {@link #code()} for Marketing (Node) to act on,
 * instead of matching words in the message. Status and message are what they were before codes existed;
 * {@link MarketingErrorAdvice} adds the code to the body. The codes: docs/redesign/MARKETING_SSO_CODES.md.
 */
public class MarketingRefusal extends ResponseStatusException {

    private final String code;

    public MarketingRefusal(HttpStatus status, String code, String message) {
        super(status, message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
