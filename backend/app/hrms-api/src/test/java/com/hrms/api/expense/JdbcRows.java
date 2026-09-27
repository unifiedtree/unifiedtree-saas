package com.hrms.api.expense;

import org.mockito.stubbing.Answer;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Feeds rows (column → value) to a mocked JdbcTemplate.query(sql, RowCallbackHandler, args...). */
final class JdbcRows {

    private JdbcRows() {
    }

    static Answer<Void> feed(List<Map<String, Object>> rows) {
        return inv -> {
            RowCallbackHandler handler = inv.getArgument(1);
            for (Map<String, Object> row : rows) handler.processRow(resultSet(row));
            return null;
        };
    }

    static ResultSet resultSet(Map<String, Object> row) throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getString(anyString())).thenAnswer(i -> {
            Object v = row.get(i.<String>getArgument(0));
            return v == null ? null : v.toString();
        });
        when(rs.getObject(anyString(), eq(UUID.class))).thenAnswer(i -> row.get(i.<String>getArgument(0)));
        when(rs.getBigDecimal(anyString())).thenAnswer(i -> (BigDecimal) row.get(i.<String>getArgument(0)));
        when(rs.getInt(anyString())).thenAnswer(i -> {
            Object v = row.get(i.<String>getArgument(0));
            return v == null ? 0 : ((Number) v).intValue();
        });
        when(rs.getLong(anyString())).thenAnswer(i -> {
            Object v = row.get(i.<String>getArgument(0));
            return v == null ? 0L : ((Number) v).longValue();
        });
        return rs;
    }
}
