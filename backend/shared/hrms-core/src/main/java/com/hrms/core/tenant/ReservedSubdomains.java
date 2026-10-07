package com.hrms.core.tenant;

import java.util.Locale;
import java.util.Set;

/**
 * Workspace addresses (the {@code <name>} in {@code <name>.unifiedtree.com}) that belong to
 * UnifiedTree itself and can never be a business. The wildcard {@code *.unifiedtree.com} serves the
 * business app, but these names are, or will be, other hosts: the website (www), the API, the owner
 * console (admin), the Marketing app (marketing), the business entry (business), mail, static assets
 * and so on. Letting a business take one would hijack that host's traffic.
 *
 * <p>The one list for every check: sign-up's availability probe and every path that creates a
 * workspace refuse these names, and the public sign-in lookup answers "reserved" for them instead of
 * "not found", so the web app shows a neutral page rather than a business sign-in. A business that
 * already holds one of these names (created before the name was added, e.g. local test data) keeps
 * working: the lookup finds it first.
 */
public final class ReservedSubdomains {

    /** What sign-up shows when someone picks one of these names. */
    public static final String MESSAGE = "This workspace address is reserved. Please choose another.";

    private static final Set<String> NAMES = Set.of(
            "www", "api", "admin", "app", "apps", "platform", "dashboard",
            "business", "marketing",
            "mail", "email", "smtp", "imap", "ftp", "ns", "ns1", "ns2", "dns",
            "static", "assets", "cdn", "img", "images", "media", "files",
            "status", "health", "metrics", "monitor", "grafana", "prometheus",
            "blog", "docs", "help", "support", "billing", "pay", "payment",
            "payments", "checkout", "auth", "login", "signup", "register",
            "account", "accounts", "console", "control", "internal", "test",
            "staging", "stage", "dev", "demo", "sandbox", "preview", "vercel",
            "railway", "root", "unifiedtree", "webhook", "webhooks",
            "ws", "socket", "vpn", "git", "ci", "cd", "ops", "noc", "sec");

    private ReservedSubdomains() {}

    /** True when {@code name} (any case, surrounding spaces ignored) is a reserved address. */
    public static boolean isReserved(String name) {
        return name != null && NAMES.contains(name.trim().toLowerCase(Locale.ROOT));
    }

    /** Every reserved address, lower-case. */
    public static Set<String> all() {
        return NAMES;
    }
}
