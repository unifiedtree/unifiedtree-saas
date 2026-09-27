package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSource;
import com.hrms.employee.entity.Employee;

import java.time.LocalDate;
import java.util.List;

/**
 * One kind of dated thing on "Around you". Adding one (for example team
 * messages once their table exists) is one more small class like this.
 */
public interface AroundSource extends EssSource {

    /**
     * What happens between {@code from} and {@code to} (both included).
     *
     * @param me the caller's own employee record (their company, department and team)
     */
    List<AroundItem> load(EssCaller caller, Employee me, LocalDate from, LocalDate to);
}
