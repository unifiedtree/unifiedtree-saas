package com.unifiedtree.attendance.api;

import com.unifiedtree.attendance.api.AttendanceApiDtos.AttendanceDto;
import com.unifiedtree.attendance.api.AttendanceApiDtos.AttendanceHomeResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.AttendanceRecordResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.CheckInRequest;
import com.unifiedtree.attendance.api.AttendanceApiDtos.CheckOutRequest;
import com.unifiedtree.attendance.api.AttendanceApiDtos.CheckOutSummaryResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.CorrectionRequestRequest;
import com.unifiedtree.attendance.api.AttendanceApiDtos.CorrectionRequestResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.DayRecordResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.GeoValidateRequest;
import com.unifiedtree.attendance.api.AttendanceApiDtos.GeoValidateResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.MonthlyStatsResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.PageResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.WeeklySummaryResponse;
import jakarta.validation.Valid;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/v1/attendance")
@Profile("canonical-jdbc-api")
public class CanonicalAttendanceController {
    private final CanonicalAttendanceService attendance;

    public CanonicalAttendanceController(CanonicalAttendanceService attendance) {
        this.attendance = attendance;
    }

    @GetMapping("/app/home")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public AttendanceHomeResponse home() {
        return attendance.home();
    }

    @PostMapping("/geo-fence/check")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public GeoValidateResponse geoFence(@Valid @RequestBody GeoValidateRequest request) {
        return attendance.geoFence(request.latitude(), request.longitude());
    }

    @PostMapping("/checkin")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public AttendanceDto checkIn(@Valid @RequestBody CheckInRequest request) {
        return attendance.checkIn(request);
    }

    @PostMapping("/checkout")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public AttendanceDto checkOut(@RequestBody(required = false) CheckOutRequest request) {
        return attendance.checkOut(request == null ? new CheckOutRequest(null, null, null, null, null, null, null, null) : request);
    }

    @GetMapping("/checkout-summary")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public CheckOutSummaryResponse checkoutSummary() {
        return attendance.checkoutSummary();
    }

    @GetMapping("/today")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<AttendanceDto> today() {
        return attendance.today().map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @GetMapping("/monthly-stats")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public MonthlyStatsResponse monthlyStats(@RequestParam(required = false) Integer year,
                                             @RequestParam(required = false) Integer month) {
        return attendance.monthlyStats(year, month);
    }

    @GetMapping("/history")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public List<DayRecordResponse> history(@RequestParam(required = false) Integer year,
                                           @RequestParam(required = false) Integer month) {
        return attendance.history(year, month);
    }

    @GetMapping("/weekly-summary")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public WeeklySummaryResponse weeklySummary(@RequestParam(required = false) LocalDate weekStart) {
        return attendance.weeklySummary(weekStart);
    }

    @GetMapping("/my")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public PageResponse<AttendanceRecordResponse> myRecords(@RequestParam(defaultValue = "0") int page,
                                                            @RequestParam(defaultValue = "31") int size) {
        return attendance.myRecords(page, size);
    }

    @PostMapping("/corrections")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public CorrectionRequestResponse createCorrection(@Valid @RequestBody CorrectionRequestRequest request) {
        return attendance.createCorrection(request);
    }

    @GetMapping("/corrections/my")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public PageResponse<CorrectionRequestResponse> myCorrections(@RequestParam(defaultValue = "0") int page,
                                                                 @RequestParam(defaultValue = "20") int size) {
        return attendance.myCorrections(page, size);
    }

}
