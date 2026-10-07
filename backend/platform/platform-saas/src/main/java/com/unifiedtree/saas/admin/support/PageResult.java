package com.unifiedtree.saas.admin.support;

import java.util.List;

/**
 * One page of a platform-admin list. Same field names as the rest of the API's
 * {@code PageResponse} ({@code content, page, size, totalElements, totalPages, last}),
 * so the admin console reads every list the same way.
 */
public record PageResult<T>(List<T> content, int page, int size, long totalElements, int totalPages, boolean last) {

    public static final int MAX_SIZE = 200;

    /** A page that the database already cut ({@code LIMIT/OFFSET}); {@code total} is the full count. */
    public static <T> PageResult<T> of(List<T> content, int page, int size, long total) {
        int pages = size <= 0 ? 0 : (int) Math.ceil(total / (double) size);
        return new PageResult<>(List.copyOf(content), page, size, total, pages, page + 1 >= pages);
    }

    /** Cut a page out of a list assembled in memory (cross-workspace reads). */
    public static <T> PageResult<T> slice(List<T> all, int page, int size) {
        int from = Math.min(page * size, all.size());
        int to = Math.min(from + size, all.size());
        return of(all.subList(from, to), page, size, all.size());
    }

    /** Clamp what a caller asked for: page from 0, size 1..MAX_SIZE (default 25). */
    public static int page(Integer requested) {
        return requested == null || requested < 0 ? 0 : requested;
    }

    public static int size(Integer requested) {
        if (requested == null || requested <= 0) return 25;
        return Math.min(requested, MAX_SIZE);
    }
}
