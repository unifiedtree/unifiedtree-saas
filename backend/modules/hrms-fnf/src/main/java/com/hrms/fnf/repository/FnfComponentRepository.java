package com.hrms.fnf.repository;

import com.hrms.fnf.entity.FnfComponent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface FnfComponentRepository extends JpaRepository<FnfComponent, UUID> {

    List<FnfComponent> findBySettlementIdOrderByTypeAscLabelAsc(UUID settlementId);

    void deleteBySettlementId(UUID settlementId);
}
