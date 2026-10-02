package com.hrms.api.letters;

import com.hrms.letters.dto.GenerateLetterRequest;
import com.hrms.letters.dto.GeneratedLetterDto;
import com.hrms.letters.dto.SendLetterRequest;
import com.hrms.letters.service.LetterGenerationService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Generating and sending a letter with the redesign's additions, each in one
 * transaction: the issue date (BW-74) and asking for a signature (BW-76).
 * When HR asks for a signature and signatures aren't switched on yet (V143.60
 * not applied), nothing is generated or sent: the request answers
 * FEATURE_NOT_READY first. Without a signature asked, both work exactly as before.
 */
@Service
public class LetterIssueService {

    private final LetterGenerationService letters;
    private final LetterSigningService signing;
    /** The letter is saved through JPA and the signature row with JDBC: flush first, so its foreign key sees the letter. */
    @PersistenceContext
    private EntityManager em;

    public LetterIssueService(LetterGenerationService letters, LetterSigningService signing) {
        this.letters = letters;
        this.signing = signing;
    }

    @Transactional
    public GeneratedLetterDto generate(GenerateLetterRequest req, UUID userId) {
        if (req.requestSignature()) signing.requireReady();
        GeneratedLetterDto letter = letters.generate(req, userId);
        if (req.requestSignature()) {
            if (em != null) em.flush();
            signing.request(letter, userId);
            signing.notifyIfAsked(letter);
        }
        return letter;
    }

    @Transactional
    public GeneratedLetterDto send(UUID letterId, SendLetterRequest req, UUID userId) {
        if (req.signatureAsked()) {
            signing.requireReady();
            // Ask before sending, so a letter that can't be signed (void, already signed) isn't emailed either.
            signing.request(letters.getGenerated(letterId), userId);
        }
        GeneratedLetterDto letter = letters.sendLetter(letterId, req);
        signing.notifyIfAsked(letter);
        return letter;
    }
}
