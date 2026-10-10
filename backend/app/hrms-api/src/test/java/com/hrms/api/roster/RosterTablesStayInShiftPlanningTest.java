package com.hrms.api.roster;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Phase 1's guarantee G1 in the source (design §1.9, §4.1): no backend code outside shift planning
 * reads or writes the roster tables, so attendance, late marks, overtime, payroll and leave can't be
 * changed by a roster; and the company switch {@code rosters_drive_attendance} has no reader at all
 * (it is Phase 3's). Shift planning lives in {@code com/hrms/api/roster} (store, publish, planner)
 * and {@code com/hrms/app/roster} (the Excel import).
 */
class RosterTablesStayInShiftPlanningTest {

    static final String[] TABLES = {"rotation_templates", "rotation_template_days", "attendance.rosters", "roster_members",
            "roster_staffing", "roster_cells", "schedule_days", "schedule_day_history", "roster_settings"};

    static boolean inShiftPlanning(Path p) {
        String s = p.toString().replace('\\', '/');
        return s.contains("/com/hrms/api/roster/") || s.contains("/com/hrms/app/roster/");
    }

    /** Every main Java source of the backend (build output, tests and resources are not walked). */
    static List<Path> mainSources(Path backend) throws IOException {
        List<Path> out = new ArrayList<>();
        Files.walkFileTree(backend, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                String name = dir.getFileName() == null ? "" : dir.getFileName().toString();
                boolean skip = name.equals("target") || name.equals("node_modules") || name.startsWith(".")
                        || name.equals("test") || name.equals("resources");
                return skip && !dir.equals(backend) ? FileVisitResult.SKIP_SUBTREE : FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                if (file.toString().endsWith(".java") && file.toString().replace('\\', '/').contains("/src/main/java/")) out.add(file);
                return FileVisitResult.CONTINUE;
            }
        });
        return out;
    }

    @Test
    void onlyShiftPlanningTouchesTheRosterTables() throws IOException {
        Path backend = Paths.get("").toAbsolutePath().getParent().getParent();
        assertTrue(Files.isDirectory(backend.resolve("modules").resolve("hrms-attendance")), "run from backend/app/hrms-api: " + backend);
        List<String> outside = new ArrayList<>();
        int scanned = 0;
        for (Path p : mainSources(backend)) {
            scanned++;
            if (inShiftPlanning(p)) continue;
            String text = Files.readString(p);
            for (String t : TABLES) {
                if (text.contains(t)) outside.add(backend.relativize(p) + " mentions " + t);
            }
        }
        assertTrue(scanned > 500, "the whole backend was scanned (" + scanned + " files)");
        assertEquals(List.of(), outside);
    }

    @Test
    void nothingReadsTheRostersDriveAttendanceSwitch() throws IOException {
        Path backend = Paths.get("").toAbsolutePath().getParent().getParent();
        List<String> readers = new ArrayList<>();
        for (Path p : mainSources(backend)) {
            String text = Files.readString(p);
            if (text.contains("rosters_drive_attendance") && !p.getFileName().toString().equals("RosterSettingsService.java")) {
                readers.add(backend.relativize(p).toString());
            }
        }
        // RosterSettingsService only shows it on the settings answer; it never decides anything.
        assertEquals(List.of(), readers);
    }
}
