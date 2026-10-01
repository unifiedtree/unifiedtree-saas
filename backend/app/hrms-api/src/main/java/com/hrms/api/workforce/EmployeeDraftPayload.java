package com.hrms.api.workforce;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * What an Add-employee draft may keep (redesign BW-92, AUDIT §5.6: "Drafts
 * never store PAN, Aadhaar or bank details"). Pure: the draft service calls
 * {@link #strip} on every payload before it touches the database.
 *
 * <p>Removed, at any depth and whatever the spelling ("panNumber",
 * "pan_number", "PAN"): PAN, Aadhaar, passport, UAN, ESI, and every bank field
 * (bank name, account number, IFSC, branch, account holder). Everything else
 * the form holds (names, contact, job, dates, salary frequency and amount,
 * address) is kept, and the draft is shown only to the person who saved it.
 */
public final class EmployeeDraftPayload {

    private EmployeeDraftPayload() {}

    /** Largest payload kept, as JSON text; a form is a few kilobytes. */
    static final int MAX_CHARS = 32_768;

    /** Field names, lower-cased with everything but letters and digits removed. */
    static final Set<String> SENSITIVE = Set.of(
            "pan", "pannumber", "panno",
            "aadhaar", "aadhaarnumber", "aadhar", "aadharnumber", "aadhaarno",
            "passport", "passportnumber", "passportno",
            "uan", "uannumber", "pfuan", "pfuannumber",
            "esi", "esinumber", "esic", "esicnumber",
            "bankname", "bankaccount", "bankaccountnumber", "accountnumber", "bankaccountno", "accountno",
            "bankifsc", "ifsc", "ifsccode", "bankifsccode",
            "bankbranch", "bankbranchname",
            "bankaccountholder", "bankaccountholdername", "accountholdername");

    static String normalise(String field) {
        return field == null ? "" : field.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    static boolean sensitive(String field) {
        return SENSITIVE.contains(normalise(field));
    }

    /**
     * Removes every sensitive field from {@code payload} (in place) and returns
     * the paths removed ("panNumber", "bank.ifsc", "people[0].pan").
     */
    public static List<String> strip(ObjectNode payload) {
        List<String> removed = new ArrayList<>();
        stripObject(payload, "", removed);
        return removed;
    }

    private static void stripObject(ObjectNode node, String path, List<String> removed) {
        Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> f = fields.next();
            String here = path.isEmpty() ? f.getKey() : path + "." + f.getKey();
            if (sensitive(f.getKey())) {
                fields.remove();
                removed.add(here);
            } else {
                strip(f.getValue(), here, removed);
            }
        }
    }

    private static void strip(JsonNode value, String path, List<String> removed) {
        if (value instanceof ObjectNode o) {
            stripObject(o, path, removed);
        } else if (value instanceof ArrayNode a) {
            for (int i = 0; i < a.size(); i++) strip(a.get(i), path + "[" + i + "]", removed);
        }
    }

    /** "First Last", else the work email, else null: how the drafts list names a draft. */
    public static String displayName(JsonNode payload) {
        if (payload == null) return null;
        String first = text(payload, "firstName");
        String last = text(payload, "lastName");
        String name = ((first == null ? "" : first) + " " + (last == null ? "" : last)).trim();
        if (!name.isEmpty()) return name;
        return text(payload, "email");
    }

    private static String text(JsonNode payload, String field) {
        JsonNode v = payload.get(field);
        if (v == null || !v.isTextual()) return null;
        String s = v.asText().trim();
        return s.isEmpty() ? null : s;
    }
}
