package com.hrms.api.workforce.search;

import com.hrms.employee.workforce.service.WorkforceEmployeeService;

import java.util.List;

/**
 * The typed query, normalised once: trimmed, single-spaced, lower-cased, capped
 * (the people search's own rules), split into at most four words.
 *
 * <p>A record matches when every remaining word appears somewhere in it. Words
 * that name the type ("leave", "payslips") are taken out first, so "leave" alone
 * lists the latest leave requests and "leave ravi" lists Ravi's.
 */
public record SearchText(String normalized, List<String> tokens) {

    public static final int MIN_QUERY_CHARS = WorkforceEmployeeService.SEARCH_MIN_QUERY_CHARS;

    public static SearchText of(String raw) {
        String q = WorkforceEmployeeService.normalizeSearchQuery(raw);
        return new SearchText(q, WorkforceEmployeeService.searchTokens(q));
    }

    public boolean tooShort() {
        return normalized.length() < MIN_QUERY_CHARS;
    }

    /** True when one of the words names this type. */
    public boolean namesType(SearchType type) {
        return tokens.stream().anyMatch(type.keywords::contains);
    }

    /** The words a record of this type has to contain (the type's own name taken out). */
    public List<String> wordsFor(SearchType type) {
        return tokens.stream().filter(t -> !type.keywords.contains(t)).toList();
    }

    /** LIKE pattern for one word: matched literally, anywhere. */
    static String contains(String word) {
        return "%" + word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }
}
