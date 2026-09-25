package com.hrms.api.hiring;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailDeliveryException;
import com.hrms.api.mail.MailService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import com.hrms.hiring.dto.HiringOfferResponse;
import com.hrms.hiring.enums.OfferStatus;
import com.hrms.hiring.repository.CandidateRepository;
import com.hrms.hiring.repository.HiringOfferRepository;
import com.hrms.hiring.service.HiringService;
import com.hrms.letters.service.PdfRenderer;
import com.unifiedtree.notifications.template.NotificationEmailComposer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Emails an offer letter (saved terms + PDF) through the configured provider.
 *
 * <p>The provider call is a network call whose outcome can be unknowable (a
 * timeout, a lost response). Sending used to happen inside one database
 * transaction: a provider timeout rolled the offer back to "not emailed" even
 * if the message had been accepted, and a failed commit after an accepted send
 * did the same — either way the next click could send the candidate a second
 * offer. Now each send goes through a durable attempt ledger
 * ({@link OfferEmailAttemptStore}, V141):
 *
 * <ol>
 *   <li>record — in its own transaction: validate, refuse if an earlier attempt
 *       is still PENDING/UNCERTAIN, write a PENDING attempt;</li>
 *   <li>send — outside any transaction;</li>
 *   <li>finish — ACCEPTED (offer marked SENT with recipient + timestamp),
 *       NOT_SENT (provider certainly did not accept: safe to retry) or
 *       UNCERTAIN (unknown: blocked until an operator records the outcome).</li>
 * </ol>
 *
 * <p>If the "finish" write itself fails after an accepted send, the attempt
 * stays PENDING and blocks further sends — the safe direction. Nothing is ever
 * retried automatically. Provider acceptance is not inbox delivery.
 */
@Service
public class OfferDeliveryService {
    private final HiringOfferRepository offers;
    private final CandidateRepository candidates;
    private final HiringService hiring;
    private final WorkforceCompanyRepository companies;
    private final PdfRenderer pdf;
    private final MailService mail;
    private final OfferEmailAttemptStore attempts;
    private final TransactionOperations tx;
    /** The company's "hiring.offer" email template (a cover message above the offer); null in unit tests. */
    private final NotificationEmailComposer composer;

    @Autowired
    public OfferDeliveryService(HiringOfferRepository offers, CandidateRepository candidates, HiringService hiring,
            WorkforceCompanyRepository companies, PdfRenderer pdf, MailService mail,
            OfferEmailAttemptStore attempts, PlatformTransactionManager txManager,
            NotificationEmailComposer composer) {
        this(offers, candidates, hiring, companies, pdf, mail, attempts, new TransactionTemplate(txManager), composer);
    }

    OfferDeliveryService(HiringOfferRepository offers, CandidateRepository candidates, HiringService hiring,
            WorkforceCompanyRepository companies, PdfRenderer pdf, MailService mail,
            OfferEmailAttemptStore attempts, TransactionOperations tx) {
        this(offers, candidates, hiring, companies, pdf, mail, attempts, tx, null);
    }

    OfferDeliveryService(HiringOfferRepository offers, CandidateRepository candidates, HiringService hiring,
            WorkforceCompanyRepository companies, PdfRenderer pdf, MailService mail,
            OfferEmailAttemptStore attempts, TransactionOperations tx, NotificationEmailComposer composer) {
        this.offers = offers; this.candidates = candidates; this.hiring = hiring;
        this.companies = companies; this.pdf = pdf; this.mail = mail;
        this.attempts = attempts; this.tx = tx; this.composer = composer;
    }

    private record Prepared(HiringOfferResponse alreadySubmitted, UUID attemptId, EmailMessage message) {}

    public HiringOfferResponse send(UUID id, String recipient, String actor) {
        String email = recipient.trim();
        Prepared prepared = tx.execute(status -> prepare(id, email, actor));
        if (prepared.alreadySubmitted() != null) return prepared.alreadySubmitted();

        try {
            mail.send(prepared.message());
        } catch (RuntimeException e) {
            boolean notSent = definitelyNotSent(e);
            tx.executeWithoutResult(status -> attempts.complete(prepared.attemptId(),
                    notSent ? OfferEmailAttemptStore.NOT_SENT : OfferEmailAttemptStore.UNCERTAIN, describe(e)));
            if (notSent) {
                throw new HrmsException("The mail provider did not accept the offer email (" + describe(e)
                        + "). Nothing was sent — you can retry.", HttpStatus.BAD_GATEWAY, "OFFER_EMAIL_NOT_SENT");
            }
            throw new HrmsException("The mail provider did not confirm the offer email (" + describe(e)
                    + "). It may still have been sent. Check with the provider or the candidate, then record the outcome"
                    + " before sending again.", HttpStatus.BAD_GATEWAY, "OFFER_EMAIL_UNCERTAIN");
        }

        return tx.execute(status -> {
            attempts.complete(prepared.attemptId(), OfferEmailAttemptStore.ACCEPTED, null);
            markSubmitted(id, email);
            return hiring.getOffer(id);
        });
    }

    /** Backwards-compatible entry for callers without an actor. */
    public HiringOfferResponse send(UUID id, String recipient) {
        return send(id, recipient, null);
    }

    private Prepared prepare(UUID id, String email, String actor) {
        var offer = offers.findForUpdate(id).orElseThrow(() -> new ResourceNotFoundException("HiringOffer", id));
        if (offer.getEmailSubmittedAt() != null) {
            if (!email.equalsIgnoreCase(offer.getEmailRecipient()))
                throw new BusinessRuleException("This offer was already submitted to another recipient", "OFFER_ALREADY_EMAILED");
            return new Prepared(hiring.getOffer(id), null, null); // repeated clicks do not send a second message
        }
        attempts.openAttempt(id).ifPresent(open -> {
            throw new HrmsException("An earlier send to " + open.recipient() + " at " + open.createdAt()
                    + " was not confirmed by the provider. Record whether it arrived before sending again.",
                    HttpStatus.CONFLICT, "OFFER_EMAIL_UNRESOLVED");
        });
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
        String name = company.getLegalName() == null ? company.getName() : company.getLegalName();
        HiringOfferResponse details = hiring.getOffer(id);
        String html = OfferDocumentController.documentHtml(details, name);
        byte[] attachment = pdf.render(html);
        // With a "hiring.offer" email template, the admin's message goes first and the
        // offer follows it (still attached as a PDF). Without one: the offer on its own.
        String subject = "Employment offer";
        String body = html;
        if (composer != null) {
            java.util.Map<String, String> values = new java.util.HashMap<>();
            values.put("candidateName", offer.getCandidateName());
            values.put("roleTitle", details.roleTitle());
            values.put("companyName", name);
            values.put("joiningDate", details.joiningDate() == null ? "" : details.joiningDate().toString());
            values.put("offeredCtc", details.offeredCtc() == null ? "" : details.offeredCtc().toPlainString());
            var composed = composer.compose(offer.getTenantId(), offer.getCompanyId(), "hiring.offer", values, subject, html);
            if (composed.templated()) {
                subject = composed.subject();
                body = composed.html() + "<hr />" + html;
            }
        }
        UUID attemptId = attempts.start(id, email, actor);
        EmailMessage message = new EmailMessage(email, offer.getCandidateName(), subject, body, null, List.of(),
                List.of(new EmailMessage.Attachment("offer-" + id + ".pdf", "application/pdf", attachment)));
        return new Prepared(null, attemptId, message);
    }

    private void markSubmitted(UUID id, String email) {
        var offer = offers.findForUpdate(id).orElseThrow(() -> new ResourceNotFoundException("HiringOffer", id));
        if (offer.getStatus() == OfferStatus.DRAFT) hiring.updateOfferStatus(id, OfferStatus.SENT);
        offer = offers.findForUpdate(id).orElseThrow(() -> new ResourceNotFoundException("HiringOffer", id));
        offer.setEmailRecipient(email);
        offer.setEmailSubmittedAt(Instant.now());
        offers.saveAndFlush(offer);
    }

    public List<OfferEmailAttemptStore.Attempt> attempts(UUID offerId) {
        // An unknown offer is a 404, not an empty history that looks like "never emailed".
        if (!offers.existsById(offerId)) throw new ResourceNotFoundException("HiringOffer", offerId);
        return attempts.list(offerId);
    }

    /**
     * An operator records what happened to an unconfirmed attempt, after
     * checking with the provider or the candidate. DELIVERED marks the offer
     * emailed (so it cannot be sent again); NOT_SENT clears the block so a new
     * send is allowed.
     */
    public HiringOfferResponse resolve(UUID offerId, UUID attemptId, boolean delivered, String note, String actor) {
        return tx.execute(status -> {
            offers.findForUpdate(offerId).orElseThrow(() -> new ResourceNotFoundException("HiringOffer", offerId));
            var attempt = attempts.find(attemptId)
                    .filter(a -> a.offerId().equals(offerId))
                    .orElseThrow(() -> new ResourceNotFoundException("OfferEmailAttempt", attemptId));
            if (!OfferEmailAttemptStore.PENDING.equals(attempt.status()) && !OfferEmailAttemptStore.UNCERTAIN.equals(attempt.status()))
                throw new BusinessRuleException("This attempt already has a recorded outcome", "OFFER_EMAIL_ATTEMPT_CLOSED");
            if (note == null || note.isBlank())
                throw new BusinessRuleException("Say how the outcome was confirmed", "OFFER_EMAIL_RESOLUTION_NOTE_REQUIRED");
            attempts.resolve(attemptId, delivered ? OfferEmailAttemptStore.ACCEPTED : OfferEmailAttemptStore.NOT_SENT, actor, note.trim());
            if (delivered) markSubmitted(offerId, attempt.recipient());
            return hiring.getOffer(offerId);
        });
    }

    /**
     * True only when the provider certainly did not accept the message. A
     * timeout anywhere in the chain means "unknown" and wins over everything
     * else; unrecognised failures are also "unknown".
     */
    static boolean definitelyNotSent(Throwable e) {
        boolean certain = false;
        for (Throwable t = e; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof java.net.SocketTimeoutException) return false;
            if (t instanceof java.net.http.HttpTimeoutException && !(t instanceof java.net.http.HttpConnectTimeoutException)) return false;
            if (t instanceof MailDeliveryException m && m.definitelyNotSent()) certain = true;
            if (t instanceof java.net.ConnectException || t instanceof java.net.UnknownHostException
                    || t instanceof java.net.http.HttpConnectTimeoutException
                    || t instanceof org.springframework.mail.MailAuthenticationException
                    || t instanceof jakarta.mail.AuthenticationFailedException
                    || t instanceof jakarta.mail.SendFailedException
                    || t instanceof java.io.UnsupportedEncodingException) certain = true;
            if (t instanceof org.springframework.mail.MailSendException send) {
                for (Exception failure : send.getFailedMessages().values()) {
                    if (!definitelyNotSent(failure)) return false;
                    certain = true;
                }
            }
        }
        return certain;
    }

    private static String describe(Throwable e) {
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        return m.length() > 300 ? m.substring(0, 300) : m;
    }
}
