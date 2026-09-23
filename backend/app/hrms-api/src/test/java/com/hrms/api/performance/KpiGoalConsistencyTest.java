package com.hrms.api.performance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.performance.dto.GoalProgressRequest;
import com.hrms.performance.entity.Goal;
import com.hrms.performance.repository.GoalRepository;
import com.hrms.performance.service.GoalService;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class KpiGoalConsistencyTest {
    @Test void percentageSliderCannotOverwriteMeasuredKpi() {
        GoalRepository repository = mock(GoalRepository.class);
        UUID id = UUID.randomUUID(), employee = UUID.randomUUID();
        Goal goal = new Goal();
        goal.setEmployeeId(employee);
        goal.setTargetValue(BigDecimal.valueOf(200));
        goal.setCurrentValue(BigDecimal.valueOf(50));
        goal.setProgress(25);
        when(repository.findById(id)).thenReturn(Optional.of(goal));
        assertThrows(BusinessRuleException.class, () -> new GoalService(repository).updateProgress(id, employee, new GoalProgressRequest(90)));
        assertEquals(25, goal.getProgress());
        assertEquals(BigDecimal.valueOf(50), goal.getCurrentValue());
        verify(repository, never()).save(any());
    }

    @Test void personalGoalsKeepPercentageBasedUpdates() {
        GoalRepository repository = mock(GoalRepository.class);
        UUID id = UUID.randomUUID(), employee = UUID.randomUUID();
        Goal goal = new Goal();
        goal.setEmployeeId(employee);
        when(repository.findById(id)).thenReturn(Optional.of(goal));
        when(repository.save(goal)).thenReturn(goal);
        assertEquals(60, new GoalService(repository).updateProgress(id, employee, new GoalProgressRequest(60)).progress());
        verify(repository).save(goal);
    }
}
