package com.hrms.letters.service;

import com.hrms.letters.LettersModuleConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.UUID;

/**
 * Phase 1: local filesystem storage.
 * Phase 2: swap for an S3/MinIO implementation behind the same interface.
 *
 * LIMITATION: Local path is node-local — does NOT scale across multiple instances.
 * Switch to S3 before deploying multi-instance or using a PVC-less cloud environment.
 */
@Service
public class LetterStorageService {

    private static final Logger log = LoggerFactory.getLogger(LetterStorageService.class);

    private final String basePath;

    public LetterStorageService(LettersModuleConfig.LettersProperties props) {
        this.basePath = props.localPath();
    }

    public String store(UUID tenantId, UUID letterId, byte[] pdfBytes) {
        try {
            Path dir = Paths.get(basePath, tenantId.toString());
            Files.createDirectories(dir);
            Path file = dir.resolve(letterId + ".pdf");
            Files.write(file, pdfBytes);
            log.debug("PDF stored: {}", file);
            return file.toAbsolutePath().toString();
        } catch (IOException e) {
            throw new RuntimeException("Failed to store PDF for letter " + letterId, e);
        }
    }

    public byte[] load(String pdfPath) {
        try {
            return Files.readAllBytes(Paths.get(pdfPath));
        } catch (IOException e) {
            throw new RuntimeException("Failed to load PDF from " + pdfPath, e);
        }
    }

    public boolean exists(String pdfPath) {
        return pdfPath != null && Files.exists(Paths.get(pdfPath));
    }
}
