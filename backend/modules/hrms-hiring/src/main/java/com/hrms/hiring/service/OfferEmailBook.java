package com.hrms.hiring.service;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/**
 * The candidate's email typed on an offer (hiring_mgmt.offer_candidate_emails,
 * V143.59: a side table, because hiring_mgmt.offers is JPA-mapped). The API
 * layer supplies the JDBC implementation.
 */
public interface OfferEmailBook {

    /**
     * Stores (or, with a null email, removes) the offer's candidate email, in
     * the caller's transaction. Returns false, and stores nothing, while the
     * migration is not applied.
     */
    boolean save(UUID offerId, String email);

    /** The stored emails of these offers by offer id; empty while the migration is not applied. */
    Map<UUID, String> find(Collection<UUID> offerIds);

    /** For tests and for wiring without the API layer: stores nothing. */
    OfferEmailBook NONE = new OfferEmailBook() {
        @Override public boolean save(UUID offerId, String email) { return false; }
        @Override public Map<UUID, String> find(Collection<UUID> offerIds) { return Map.of(); }
    };
}
