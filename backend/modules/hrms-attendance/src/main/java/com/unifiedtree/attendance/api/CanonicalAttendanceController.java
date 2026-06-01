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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

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
    public AttendanceHomeResponse home() {
        return attendance.home();
    }

    @PostMapping("/geo-fence/check")
    public GeoValidateResponse geoFence(@Valid @RequestBody GeoValidateRequest request) {
        return attendance.geoFence(request.latitude(), request.longitude());
    }

    @PostMapping("/checkin")
    public AttendanceDto checkIn(@Valid @RequestBody CheckInRequest request) {
        return attendance.checkIn(request);
    }

    @PostMapping("/checkout")
    public AttendanceDto checkOut(@RequestBody(required = false) CheckOutRequest request) {
        return attendance.checkOut(request == null ? new CheckOutRequest(null, null, null, null, null, null, null, null) : request);
    }

    @GetMapping("/checkout-summary")
    public CheckOutSummaryResponse checkoutSummary() {
        return attendance.checkoutSummary();
    }

    @GetMapping("/today")
    public ResponseEntity<AttendanceDto> today() {
        return attendance.today().map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @GetMapping("/monthly-stats")
    public MonthlyStatsResponse monthlyStats(@RequestParam(required = false) Integer year,
                                             @RequestParam(required = false) Integer month) {
        return attendance.monthlyStats(year, month);
    }

    @GetMapping("/history")
    public List<DayRecordResponse> history(@RequestParam(required = false) Integer year,
                                           @RequestParam(required = false) Integer month) {
        return attendance.history(year, month);
    }

    @GetMapping("/weekly-summary")
    public WeeklySummaryResponse weeklySummary() {
        return attendance.weeklySummary();
    }

    @GetMapping("/my")
    public PageResponse<AttendanceRecordResponse> myRecords(@RequestParam(defaultValue = "0") int page,
                                                            @RequestParam(defaultValue = "31") int size) {
        return attendance.myRecords(page, size);
    }

    @PostMapping("/corrections")
    public CorrectionRequestResponse createCorrection(@Valid @RequestBody CorrectionRequestRequest request) {
        return attendance.createCorrection(request);
    }

    @GetMapping("/corrections/my")
    public PageResponse<CorrectionRequestResponse> myCorrections(@RequestParam(defaultValue = "0") int page,
                                                                 @RequestParam(defaultValue = "20") int size) {
        return attendance.myCorrections(page, size);
    }

}
