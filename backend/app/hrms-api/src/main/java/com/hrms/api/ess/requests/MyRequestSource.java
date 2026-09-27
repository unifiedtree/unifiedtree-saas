package com.hrms.api.ess.requests;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSource;

import java.util.List;

/**
 * One kind of request on "My requests". Adding a kind (for example submitted
 * timesheet weeks once their table exists) is one more small class like this.
 */
public interface MyRequestSource extends EssSource {

    /** The caller's own requests of this kind, waiting ones first, then newest first; at most {@code limit}. */
    List<MyRequest> load(EssCaller caller, int limit);
}
