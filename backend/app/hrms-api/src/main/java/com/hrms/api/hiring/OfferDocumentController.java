package com.hrms.api.hiring;

import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import com.hrms.hiring.dto.HiringOfferResponse;
import com.hrms.hiring.service.HiringService;
import com.hrms.letters.service.PdfRenderer;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.util.HtmlUtils;

import java.util.UUID;

@RestController
@RequestMapping("/v1/hiring/offers")
public class OfferDocumentController {
    private final HiringService hiring;
    private final WorkforceCompanyRepository companies;
    private final PdfRenderer renderer;

    public OfferDocumentController(HiringService hiring, WorkforceCompanyRepository companies, PdfRenderer renderer) {
        this.hiring = hiring;
        this.companies = companies;
        this.renderer = renderer;
    }

    @GetMapping(value = "/{id}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize("hasAnyAuthority('hrms.hiring.offer.read','hrms.hiring.read')")
    public ResponseEntity<byte[]> download(@PathVariable UUID id) {
        HiringOfferResponse offer = hiring.getOffer(id);
        var company = companies.findById(offer.companyId())
                .orElseThrow(() -> new ResourceNotFoundException("Company", offer.companyId()));
        String name = company.getLegalName() == null || company.getLegalName().isBlank()
                ? company.getName() : company.getLegalName();
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
                .cacheControl(CacheControl.noStore())
                .header("Content-Disposition", "attachment; filename=\"offer-" + id + ".pdf\"")
                .body(renderer.render(documentHtml(offer, name)));
    }

    // Candidate-facing terms are plain text. Never render internal notes or user-supplied HTML/URLs.
    static String documentHtml(HiringOfferResponse offer, String companyName) {
        return """
                <h1>%s</h1><h2>Employment offer</h2>
                <p><strong>Status:</strong> %s</p><p><strong>Reference:</strong> %s</p>
                <hr /><p><strong>Candidate:</strong> %s</p><p><strong>Position:</strong> %s</p>
                <p><strong>Annual offered CTC (INR):</strong> %s</p>
                <p><strong>Proposed joining date:</strong> %s</p>
                <h3>Offer terms</h3><p>%s</p>
                """.formatted(escape(companyName), offer.status(), offer.id(), escape(offer.candidateName()),
                escape(offer.roleTitle()), offer.offeredCtc().toPlainString(),
                offer.joiningDate() == null ? "Not specified" : offer.joiningDate(),
                offer.offerTerms() == null || offer.offerTerms().isBlank() ? "No additional terms recorded."
                        : escape(offer.offerTerms()).replace("\n", "<br />"));
    }

    private static String escape(String text) {
        return HtmlUtils.htmlEscape(text == null ? "" : text);
    }
}
