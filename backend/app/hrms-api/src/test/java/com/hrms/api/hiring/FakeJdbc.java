package com.hrms.api.hiring;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;

import java.lang.reflect.Proxy;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import static org.mockito.Mockito.mock;

/**
 * A JdbcTemplate for unit tests (P-HIRE): every call is recorded, and answered
 * by the first rule whose SQL fragment it contains. Rows are maps from column
 * name to value. No database, no Mockito varargs matching.
 */
public final class FakeJdbc {

    /** One call: the JdbcTemplate method, its SQL and its bind values. */
    public record Call(String method, String sql, List<Object> args) {}

    private record Rule(String fragment, Function<Call, Object> answer) {}

    private final List<Rule> rules = new ArrayList<>();
    public final List<Call> calls = new ArrayList<>();
    public final JdbcTemplate jdbc;

    public FakeJdbc() {
        this.jdbc = mock(JdbcTemplate.class, inv -> {
            Object[] a = inv.getArguments();
            String sql = a.length > 0 && a[0] instanceof String s ? s : "";
            List<Object> args = new ArrayList<>();
            for (int i = 1; i < a.length; i++) {
                Object v = a[i];
                if (v instanceof RowCallbackHandler || v instanceof RowMapper || v instanceof ResultSetExtractor || v instanceof Class) continue;
                if (v instanceof Object[] arr) args.addAll(List.of(arr)); else args.add(v);
            }
            Call call = new Call(inv.getMethod().getName(), sql, args);
            calls.add(call);
            Object answer = null;
            for (Rule r : rules) {
                if (sql.contains(r.fragment())) { answer = r.answer().apply(call); break; }
            }
            return shape(inv.getMethod().getName(), a, answer, inv.getMethod().getReturnType());
        });
    }

    /** Answer calls whose SQL contains {@code fragment}: rows (List of Map), a single value, or a map. */
    public FakeJdbc on(String fragment, Function<Call, Object> answer) {
        rules.add(new Rule(fragment, answer));
        return this;
    }

    public FakeJdbc on(String fragment, Object answer) {
        return on(fragment, c -> answer);
    }

    /** to_regclass(?) answers for these tables: present or not. */
    public FakeJdbc tables(Map<String, Boolean> present) {
        return on("to_regclass", c -> present.getOrDefault(String.valueOf(c.args().get(0)), false));
    }

    public List<Call> callsContaining(String fragment) {
        return calls.stream().filter(c -> c.sql().contains(fragment)).toList();
    }

    @SuppressWarnings("unchecked")
    private static Object shape(String method, Object[] a, Object answer, Class<?> returnType) throws Exception {
        List<Map<String, Object>> rows = answer instanceof List<?> l && (l.isEmpty() || l.get(0) instanceof Map)
                ? (List<Map<String, Object>>) answer : null;
        for (Object arg : a) {
            if (arg instanceof RowCallbackHandler h) {
                if (rows != null) for (Map<String, Object> row : rows) h.processRow(rs(row));
                return null;
            }
            if (arg instanceof RowMapper<?> m) {
                List<Object> out = new ArrayList<>();
                if (rows != null) for (int i = 0; i < rows.size(); i++) out.add(m.mapRow(rs(rows.get(i)), i));
                if (method.equals("queryForObject")) return out.isEmpty() ? null : out.get(0);
                return out;
            }
            if (arg instanceof ResultSetExtractor<?> x) {
                return x.extractData(cursor(rows == null ? List.of() : rows));
            }
        }
        if (method.equals("update")) return answer == null ? 1 : answer;
        if (method.equals("queryForList")) return answer == null ? List.of() : answer;
        if (method.equals("queryForMap")) return answer == null ? Map.of() : answer;
        if (answer == null && returnType == int.class) return 0;
        if (answer == null && returnType == boolean.class) return false;
        return answer;
    }

    /** A one-row ResultSet over {@code row}. */
    public static ResultSet rs(Map<String, Object> row) {
        return cursor(List.of(row), 0);
    }

    private static ResultSet cursor(List<Map<String, Object>> rows) {
        return cursor(rows, -1);
    }

    private static ResultSet cursor(List<Map<String, Object>> rows, int start) {
        int[] at = {start};
        Object[] last = {null};
        return (ResultSet) Proxy.newProxyInstance(FakeJdbc.class.getClassLoader(), new Class<?>[]{ResultSet.class}, (p, m, args) -> {
            String name = m.getName();
            if (name.equals("next")) { at[0]++; return at[0] < rows.size(); }
            if (name.equals("wasNull")) return last[0] == null;
            if (name.equals("close")) return null;
            Map<String, Object> row = rows.get(Math.max(at[0], 0));
            Object v = args != null && args.length > 0 && args[0] instanceof String key ? row.get(key)
                    : args != null && args.length > 0 && args[0] instanceof Integer idx ? new ArrayList<>(row.values()).get(idx - 1) : null;
            last[0] = v;
            return switch (name) {
                case "getString" -> v == null ? null : v.toString();
                case "getLong" -> v == null ? 0L : ((Number) v).longValue();
                case "getInt" -> v == null ? 0 : ((Number) v).intValue();
                case "getBoolean" -> v != null && (Boolean) v;
                case "getTimestamp" -> v == null ? null : v instanceof Instant i ? Timestamp.from(i) : (Timestamp) v;
                case "getObject" -> v;
                default -> throw new UnsupportedOperationException(name);
            };
        });
    }
}
