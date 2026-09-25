package com.hrms.api.workforce;

import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The ⌘K people search matches word by word ("rah ver" → Rahul Verma, "sales
 * priya" → Priya in Sales) on top of the whole-query match it always had.
 * These check the statement's shape; the tenant fence (RLS) and the
 * {@code hrms.employee.read} gate are unchanged and covered by EmployeeSearchIT.
 */
class EmployeeSearchQueryTest {

    @Test
    void splitsTheQueryIntoDistinctWordsAndCapsThem() {
        assertThat(WorkforceEmployeeService.searchTokens("rahul verma")).containsExactly("rahul", "verma");
        assertThat(WorkforceEmployeeService.searchTokens("sales sales priya")).containsExactly("sales", "priya");
        assertThat(WorkforceEmployeeService.searchTokens("a b c d e f")).hasSize(4);
        assertThat(WorkforceEmployeeService.searchTokens("  ")).isEmpty();
        assertThat(WorkforceEmployeeService.searchTokens(null)).isEmpty();
    }

    @Test
    void everyWordMustMatchANameCodeEmailDepartmentOrDesignation() {
        String sql = WorkforceEmployeeService.searchSql(2);
        assertThat(sql).contains(":t0").contains(":t1").doesNotContain(":t2");
        assertThat(sql).contains("lower(coalesce(d.name, '')) LIKE :t1").contains("lower(coalesce(g.title, '')) LIKE :t0");
        // Words are ANDed together, and the word match is an alternative to the whole-query match.
        assertThat(sql).contains(") AND (lower(e.employee_code) LIKE :t1");
        assertThat(sql).contains(":contains");
    }

    @Test
    void keepsTheActiveOnlyRuleTheRankingAndTheLimit() {
        String sql = WorkforceEmployeeService.searchSql(1);
        assertThat(sql).contains("WHERE e.is_active = TRUE").contains("THEN 0").contains("THEN 1").contains("THEN 2").contains("ELSE 3").contains("LIMIT :limit");
        assertThat(sql).doesNotContain("%s");
        // LIKE metacharacters stay literal in every clause.
        long likes = sql.split(" LIKE ", -1).length - 1;
        long escapes = sql.split("ESCAPE '\\\\'", -1).length - 1;
        assertThat(escapes).isEqualTo(likes);
    }

    @Test
    void neverBuildsMoreWordClausesThanTheCap() {
        String sql = WorkforceEmployeeService.searchSql(9);
        assertThat(sql).contains(":t3").doesNotContain(":t4");
        assertThat(WorkforceEmployeeService.searchSql(0)).doesNotContain(":t0");
        assertThat(List.of(WorkforceEmployeeService.searchSql(0), WorkforceEmployeeService.searchSql(3))).allSatisfy(s -> assertThat(s).startsWith("SELECT"));
    }
}
