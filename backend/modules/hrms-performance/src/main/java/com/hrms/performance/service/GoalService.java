package com.hrms.performance.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.performance.dto.GoalProgressRequest;
import com.hrms.performance.dto.GoalRequest;
import com.hrms.performance.dto.GoalResponse;
import com.hrms.performance.entity.Goal;
import com.hrms.performance.enums.GoalStatus;
import com.hrms.performance.repository.GoalRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class GoalService {

    private static final Logger log = LoggerFactory.getLogger(GoalService.class);

    private final GoalRepository goalRepository;

    public GoalService(GoalRepository goalRepository) {
        this.goalRepository = goalRepository;
    }

    @Transactional
    public GoalResponse createGoal(UUID employeeId, GoalRequest request) {
        Goal goal = new Goal();
        goal.setTenantId(TenantContext.getTenantId());
        goal.setEmployeeId(employeeId);
        goal.setCycleId(request.cycleId());
        goal.setTitle(request.title());
        goal.setDescription(request.description());
        goal.setWeight(request.weight() != null ? request.weight() : 0);
        goal.setProgress(0);
        goal.setStatus(GoalStatus.ACTIVE);
        goal = goalRepository.save(goal);
        log.info("Goal created id={} employee={} title={}", goal.getId(), employeeId, request.title());
        return toResponse(goal);
    }

    @Transactional(readOnly = true)
    public List<GoalResponse> getMyGoals(UUID employeeId) {
        return goalRepository.findByEmployeeIdOrderByCreatedAtDesc(employeeId).stream()
                .map(this::toResponse).toList();
    }

    @Transactional
    public GoalResponse updateProgress(UUID goalId, UUID employeeId, GoalProgressRequest request) {
        Goal goal = goalRepository.findById(goalId)
                .orElseThrow(() -> new ResourceNotFoundException("Goal", goalId));
        if (!goal.getEmployeeId().equals(employeeId)) {
            throw new BusinessRuleException("You can only update your own goals", "PERFORMANCE_GOAL_FORBIDDEN");
        }
        int progress = Math.max(0, Math.min(100, request.progress()));
        goal.setProgress(progress);
        if (progress >= 100) {
            goal.setStatus(GoalStatus.COMPLETED);
        } else if (goal.getStatus() == GoalStatus.COMPLETED) {
            goal.setStatus(GoalStatus.ACTIVE);
        }
        goal = goalRepository.save(goal);
        log.info("Goal {} progress updated to {}%", goalId, progress);
        return toResponse(goal);
    }

    private GoalResponse toResponse(Goal g) {
        return new GoalResponse(
                g.getId(), g.getEmployeeId(), g.getCycleId(), g.getTitle(),
                g.getDescription(), g.getWeight(), g.getProgress(), g.getStatus(), g.getCreatedAt());
    }
}
