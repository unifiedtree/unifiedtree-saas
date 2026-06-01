package com.hrms.letters.domain;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(schema = "letters", name = "templates")
@Getter
@Setter
public class LetterTemplate extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "name", nullable = false, length = 200)
    private String name;

    @Column(name = "type", nullable = false, length = 40)
    private String type;

    @Column(name = "subject", nullable = false, length = 500)
    private String subject;

    @Column(name = "body_html", nullable = false, columnDefinition = "TEXT")
    private String bodyHtml;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "variant_name", length = 80)
    private String variantName;

    @Column(name = "deleted_at")
    private Instant deletedAt;
}
