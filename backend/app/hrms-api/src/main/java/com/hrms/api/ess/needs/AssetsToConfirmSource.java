package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.me.MyAssetsController;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

/**
 * Equipment that is with me and waiting for my "Yes, I have it": the
 * {@code canConfirm} assets of {@code GET /v1/me/assets}, read through that
 * endpoint's own code (so the rule stays in one place: with me, on an open
 * allocation, not confirmed yet, and only once confirmations are switched on).
 * Needs {@code hrms.onboarding.asset.self}; hrms module.
 */
@Component
class AssetsToConfirmSource implements NeedsYouSource {

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);

    private final MyAssetsController myAssets;

    AssetsToConfirmSource(MyAssetsController myAssets) {
        this.myAssets = myAssets;
    }

    @Override public String key() { return "ASSET_TO_CONFIRM"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("hrms.onboarding.asset.self"); }

    @Override
    public List<NeedsYouItem> load(EssCaller caller) {
        return myAssets.mine(caller.jwt()).stream()
                .filter(MyAssetsController.MyAsset::canConfirm)
                .map(a -> {
                    String name = a.assetName() != null && !a.assetName().isBlank() ? a.assetName().trim()
                            : a.assetType() != null && !a.assetType().isBlank() ? a.assetType().trim() : "asset";
                    LocalDate given = a.assignedAt();
                    String detail = joinNonBlank(a.assetTag(), given == null ? null : "handed over " + DAY.format(given));
                    return new NeedsYouItem("ASSET_TO_CONFIRM", "Confirm you have the " + name, detail,
                            given, null, NeedsYouItem.BRAND, a.assetId(), 1, "/me/assets");
                })
                .toList();
    }

    private static String joinNonBlank(String a, String b) {
        boolean hasA = a != null && !a.isBlank(), hasB = b != null && !b.isBlank();
        return hasA && hasB ? a.trim() + " · " + b : hasA ? a.trim() : hasB ? b : null;
    }
}
