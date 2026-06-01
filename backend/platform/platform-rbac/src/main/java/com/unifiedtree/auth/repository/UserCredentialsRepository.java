package com.unifiedtree.auth.repository;

import com.unifiedtree.auth.entity.UserCredentials;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserCredentialsRepository extends JpaRepository<UserCredentials, UUID> {
    /**
     * Lookup by email within the current tenant scope. RLS handles tenant
     * filtering. Explicit JPQL because Spring Data's derived
     * {@code findByEmailIgnoreCase} method is observed to return empty in
     * some Postgres setups even when a native query against the same
     * connection returns the row -- the derived implementation seems to
     * use a separate session that misses the SET LOCAL tenant context.
     */
    @Query("SELECT u FROM UserCredentials u WHERE lower(u.email) = lower(:email)")
    Optional<UserCredentials> findByEmailIgnoreCase(@Param("email") String email);
}
