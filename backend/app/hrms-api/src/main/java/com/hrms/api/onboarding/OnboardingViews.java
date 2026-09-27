package com.hrms.api.onboarding;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import com.hrms.employee.entity.OnboardingAsset;
import com.hrms.employee.entity.OnboardingTemplate;

import java.time.Instant;
import java.util.UUID;

/**
 * Response shapes that ADD fields to an entity the endpoints returned before
 * (redesign BW-69, BW-70). The entity is unwrapped, so every field it had keeps
 * its name and value, and the new fields come next to them.
 */
public final class OnboardingViews {

    private OnboardingViews() { }

    /** An open "problem reported" on an asset. */
    public record IssueBrief(UUID id, String kind, String note, Instant reportedAt) {}

    /**
     * One row of the Assets list.
     * <ul>
     *   <li>{@code holderName}: who has it now; {@code lastHolderName}: who had it
     *       last, once it is back. Both only for callers who may read employee
     *       records ({@code hrms.employee.read}); null otherwise.</li>
     *   <li>{@code confirmedAt} / {@code confirmationSource}: the holder confirmed
     *       they have it (EMPLOYEE), or it counted as confirmed when confirmations
     *       started (BACKFILL). {@code confirmationPending}: handed over and not
     *       confirmed yet. All null while V143.59 is not applied.</li>
     *   <li>{@code openIssue}: a problem the holder reported that HR has not resolved.</li>
     * </ul>
     */
    public static final class AssetView {
        @JsonUnwrapped
        private final OnboardingAsset asset;
        private final String holderName;
        private final String lastHolderName;
        private final Instant confirmedAt;
        private final String confirmationSource;
        private final Boolean confirmationPending;
        private final IssueBrief openIssue;

        public AssetView(OnboardingAsset asset, String holderName, String lastHolderName, Instant confirmedAt,
                         String confirmationSource, Boolean confirmationPending, IssueBrief openIssue) {
            this.asset = asset;
            this.holderName = holderName;
            this.lastHolderName = lastHolderName;
            this.confirmedAt = confirmedAt;
            this.confirmationSource = confirmationSource;
            this.confirmationPending = confirmationPending;
            this.openIssue = openIssue;
        }

        public OnboardingAsset getAsset() { return asset; }
        public String getHolderName() { return holderName; }
        public String getLastHolderName() { return lastHolderName; }
        public Instant getConfirmedAt() { return confirmedAt; }
        public String getConfirmationSource() { return confirmationSource; }
        public Boolean getConfirmationPending() { return confirmationPending; }
        public IssueBrief getOpenIssue() { return openIssue; }
    }

    /** One checklist template with {@code usedBy}: how many onboardings were started from it. */
    public static final class TemplateView {
        @JsonUnwrapped
        private final OnboardingTemplate template;
        private final long usedBy;

        public TemplateView(OnboardingTemplate template, long usedBy) {
            this.template = template;
            this.usedBy = usedBy;
        }

        public OnboardingTemplate getTemplate() { return template; }
        public long getUsedBy() { return usedBy; }
    }
}
