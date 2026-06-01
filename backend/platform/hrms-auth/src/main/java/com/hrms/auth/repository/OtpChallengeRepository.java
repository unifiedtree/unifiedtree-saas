package com.hrms.auth.repository;

import com.hrms.auth.entity.OtpChallenge;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface OtpChallengeRepository extends JpaRepository<OtpChallenge, UUID> {
}
