package com.hrms.letters.repository;

import com.hrms.letters.domain.DistributionRecipient;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface DistributionRecipientRepository extends JpaRepository<DistributionRecipient, UUID> {

    List<DistributionRecipient> findByJobId(UUID jobId);

    List<DistributionRecipient> findByJobIdAndSendStatus(UUID jobId, String sendStatus);
}
