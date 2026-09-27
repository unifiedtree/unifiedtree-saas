package com.hrms.api.pli;

import com.hrms.api.advance.PayFinancialYear;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Totals over the incentive awards for the redesign (BW-63), so the page no
 * longer adds up one page of rows. JDBC over existing columns; every
 * statement filters the tenant and runs in a read-only transaction.
 * Pools still pay at 100% (AUDIT §5.9): nothing here reads targets.
 */
@Service
public class PliReadService {

    private final JdbcTemplate jdbc;

    public PliReadService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** How many awards, and their amount. */
    public record Bucket(long count, BigDecimal amount) {}

    /**
     * All awards. Proposed = waiting for a decision; approved = approved and
     * not paid yet (the next payroll run pays it); paid this financial year
     * uses the payment date and the caller's company's year.
     */
    public record AwardsSummary(long total, Bucket proposed, Bucket approved, Bucket paid,
                                Bucket paidThisFinancialYear, long rejected, String financialYear,
                                LocalDate financialYearStart, LocalDate financialYearEnd) {}

    /**
     * One person's awards. {@code proposedForYou} is every award except the
     * rejected ones (all time); waiting = PROPOSED; approved = approved, to be
     * paid; paid = paid to you.
     */
    public record MyAwardsSummary(Bucket proposedForYou, Bucket waiting, Bucket approved, Bucket paid, long rejected) {}

    @Transactional(readOnly = true)
    public AwardsSummary summary(UUID tenantId, PayFinancialYear year) {
        return jdbc.query("""
                SELECT count(*)                                                        AS total,
                       count(*) FILTER (WHERE status = 'PROPOSED')                     AS p_n,
                       coalesce(sum(amount) FILTER (WHERE status = 'PROPOSED'), 0)     AS p_amt,
                       count(*) FILTER (WHERE status = 'APPROVED')                     AS a_n,
                       coalesce(sum(amount) FILTER (WHERE status = 'APPROVED'), 0)     AS a_amt,
                       count(*) FILTER (WHERE status = 'PAID')                         AS paid_n,
                       coalesce(sum(amount) FILTER (WHERE status = 'PAID'), 0)         AS paid_amt,
                       count(*) FILTER (WHERE status = 'PAID' AND paid_at >= ? AND paid_at < ?) AS fy_n,
                       coalesce(sum(amount) FILTER (WHERE status = 'PAID' AND paid_at >= ? AND paid_at < ?), 0) AS fy_amt,
                       count(*) FILTER (WHERE status = 'REJECTED')                     AS r_n
                  FROM pli_mgmt.pli_awards
                 WHERE tenant_id = ?
                """, rs -> {
                    rs.next();
                    return new AwardsSummary(rs.getLong("total"),
                            new Bucket(rs.getLong("p_n"), rs.getBigDecimal("p_amt")),
                            new Bucket(rs.getLong("a_n"), rs.getBigDecimal("a_amt")),
                            new Bucket(rs.getLong("paid_n"), rs.getBigDecimal("paid_amt")),
                            new Bucket(rs.getLong("fy_n"), rs.getBigDecimal("fy_amt")),
                            rs.getLong("r_n"), year.label(), year.start(), year.end());
                }, year.startsAt(), year.endsBefore(), year.startsAt(), year.endsBefore(), tenantId);
    }

    @Transactional(readOnly = true)
    public MyAwardsSummary mySummary(UUID tenantId, UUID employeeId) {
        return jdbc.query("""
                SELECT count(*) FILTER (WHERE status <> 'REJECTED')                     AS all_n,
                       coalesce(sum(amount) FILTER (WHERE status <> 'REJECTED'), 0)     AS all_amt,
                       count(*) FILTER (WHERE status = 'PROPOSED')                      AS p_n,
                       coalesce(sum(amount) FILTER (WHERE status = 'PROPOSED'), 0)      AS p_amt,
                       count(*) FILTER (WHERE status = 'APPROVED')                      AS a_n,
                       coalesce(sum(amount) FILTER (WHERE status = 'APPROVED'), 0)      AS a_amt,
                       count(*) FILTER (WHERE status = 'PAID')                          AS paid_n,
                       coalesce(sum(amount) FILTER (WHERE status = 'PAID'), 0)          AS paid_amt,
                       count(*) FILTER (WHERE status = 'REJECTED')                      AS r_n
                  FROM pli_mgmt.pli_awards
                 WHERE tenant_id = ? AND employee_id = ?
                """, rs -> {
                    rs.next();
                    return new MyAwardsSummary(
                            new Bucket(rs.getLong("all_n"), rs.getBigDecimal("all_amt")),
                            new Bucket(rs.getLong("p_n"), rs.getBigDecimal("p_amt")),
                            new Bucket(rs.getLong("a_n"), rs.getBigDecimal("a_amt")),
                            new Bucket(rs.getLong("paid_n"), rs.getBigDecimal("paid_amt")),
                            rs.getLong("r_n"));
                }, tenantId, employeeId);
    }
}
