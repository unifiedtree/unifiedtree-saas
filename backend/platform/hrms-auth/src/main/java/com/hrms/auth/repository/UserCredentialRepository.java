package com.hrms.auth.repository;

import com.hrms.auth.entity.UserCredential;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;
import java.util.UUID;

public interface UserCredentialRepository extends JpaRepository<UserCredential, UUID> {

    Optional<UserCredential> findByEmail(String email);

    @Query("SELECT u FROM UserCredential u WHERE u.email = :email AND u.active = true")
    Optional<UserCredential> findActiveByEmail(String email);

    @Query("SELECT u FROM UserCredential u WHERE u.mobileNumber = :mobileNumber AND u.active = true")
    Optional<UserCredential> findActiveByMobileNumber(String mobileNumber);

    java.util.List<UserCredential> findByTenantId(UUID tenantId);
}
