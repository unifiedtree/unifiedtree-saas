package com.hrms.api.hiring;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import com.hrms.hiring.dto.HiringOfferResponse;
import com.hrms.hiring.enums.OfferStatus;
import com.hrms.hiring.repository.CandidateRepository;
import com.hrms.hiring.repository.HiringOfferRepository;
import com.hrms.hiring.service.HiringService;
import com.hrms.letters.service.PdfRenderer;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class OfferDeliveryService {
    private final HiringOfferRepository offers;
    private final CandidateRepository candidates;
    private final HiringService hiring;
    private final WorkforceCompanyRepository companies;
    private final PdfRenderer pdf;
    private final MailService mail;

    public OfferDeliveryService(HiringOfferRepository offers, CandidateRepository candidates, HiringService hiring,
            WorkforceCompanyRepository companies, PdfRenderer pdf, MailService mail) {
        this.offers = offers; this.candidates = candidates; this.hiring = hiring;
        this.companies = companies; this.pdf = pdf; this.mail = mail;
    }

    @Transactional
    public HiringOfferResponse send(UUID id, String recipient) {
        var offer = offers.findForUpdate(id).orElseThrow(() -> new ResourceNotFoundException("HiringOffer", id));
        String email = recipient.trim();
        if (offer.getEmailSubmittedAt() != null) {
            if (!email.equalsIgnoreCase(offer.getEmailRecipient()))
                throw new BusinessRuleException("This offer was already submitted to another recipient", "OFFER_ALREADY_EMAILED");
            return hiring.getOffer(id); // repeated clicks do not send a second message
        }
        if (offer.getStatus() != OfferStatus.DRAFT && offer.getStatus() != OfferStatus.SENT)
            throw new BusinessRuleException("Only draft or sent offers can be emailed", "OFFER_CLOSED");
        if (offer.getOfferTerms() == null || offer.getOfferTerms().isBlank())
            throw new BusinessRuleException("Add the approved offer terms before emailing", "OFFER_TERMS_REQUIRED");
        if (offer.getCandidateId() != null) {
            var candidate = candidates.findById(offer.getCandidateId())
                    .orElseThrow(() -> new ResourceNotFoundException("Candidate", offer.getCandidateId()));
            if (candidate.getEmail() == null || !email.equalsIgnoreCase(candidate.getEmail().trim()))
                throw new BusinessRuleException("Use the linked candidate's recorded email address", "OFFER_EMAIL_MISMATCH");
        }
        var company = companies.findById(offer.getCompanyId())
                .orElseThrow(() -> new ResourceNotFoundException("Company", offer.getCompanyId()));
        hiring.updateOfferStatus(id, OfferStatus.SENT);
        String name = company.getLegalName() == null ? company.getName() : company.getLegalName();
        String html = OfferDocumentController.documentHtml(hiring.getOffer(id), name);
        byte[] attachment = pdf.render(html);
        // A successful return means provider acceptance, not delivery to the recipient's inbox.
        // No automatic retry: timeout outcomes must be checked with the provider before retrying.
        mail.send(new EmailMessage(email, offer.getCandidateName(), "Employment offer", html, null, List.of(),
                List.of(new EmailMessage.Attachment("offer-" + id + ".pdf", "application/pdf", attachment))));
        offer.setEmailRecipient(email);
        offer.setEmailSubmittedAt(Instant.now());
        offers.saveAndFlush(offer);
        return hiring.getOffer(id);
    }
}
