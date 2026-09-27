package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSource;

import java.util.List;

/**
 * One kind of thing that needs the caller. Adding one (letters to sign, assets
 * to confirm, policy deadlines, review due dates, once their tables exist) is
 * one more small class like this.
 */
public interface NeedsYouSource extends EssSource {

    /** The caller's own open items of this kind. */
    List<NeedsYouItem> load(EssCaller caller);
}
