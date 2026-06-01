package com.hrms.api.employee;

import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.dto.EmergencyContactRequest;
import com.hrms.employee.dto.EmergencyContactResponse;
import com.hrms.employee.entity.EmergencyContact;
import com.hrms.employee.entity.EmployeeAddress;
import com.hrms.employee.entity.EmployeeBankAccount;
import com.hrms.employee.entity.EmployeeDependent;
import com.hrms.employee.entity.EmployeeEducation;
import com.hrms.employee.entity.EmployeeExperience;
import com.hrms.employee.entity.EmployeeIdentity;
import com.hrms.employee.repository.EmergencyContactRepository;
import com.hrms.employee.service.EmployeeProfileService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/employees/{employeeId}/profile")
@Tag(name = "Employee Profile", description = "Employee profile sections: address, identity, bank, education, experience, dependents, emergency contacts")
@SecurityRequirement(name = "bearerAuth")
public class EmployeeProfileController {

    private final EmployeeProfileService profileService;
    private final EmergencyContactRepository emergencyContactRepo;

    public EmployeeProfileController(EmployeeProfileService profileService,
                                     EmergencyContactRepository emergencyContactRepo) {
        this.profileService = profileService;
        this.emergencyContactRepo = emergencyContactRepo;
    }

    // ── Address ───────────────────────────────────────────────────────────

    @GetMapping("/addresses")
    @Operation(summary = "List addresses for an employee")
    @PreAuthorize("@perm.check('hrms.employee.profile.read')")
    public List<EmployeeAddress> getAddresses(@PathVariable UUID employeeId) {
        return profileService.getAddresses(employeeId);
    }

    @PostMapping("/addresses")
    @Operation(summary = "Add or update an employee address")
    @PreAuthorize("@perm.check('hrms.employee.profile.write')")
    public ResponseEntity<EmployeeAddress> saveAddress(@PathVariable UUID employeeId,
                                                        @Valid @RequestBody EmployeeAddress address) {
        return ResponseEntity.status(HttpStatus.CREATED).body(profileService.saveAddress(employeeId, address));
    }

    @DeleteMapping("/addresses/{addressId}")
    @Operation(summary = "Delete an employee address")
    @PreAuthorize("@perm.check('hrms.employee.profile.write')")
    public ResponseEntity<Void> deleteAddress(@PathVariable UUID employeeId, @PathVariable UUID addressId) {
        profileService.deleteAddress(addressId);
        return ResponseEntity.noContent().build();
    }

    // ── Identity (PII — requires elevated permission) ─────────────────────

    @GetMapping("/identity")
    @Operation(summary = "Get employee identity record with decrypted PII")
    @PreAuthorize("@perm.check('hrms.employee.identity.read')")
    public IdentityResponse getIdentity(@PathVariable UUID employeeId) {
        EmployeeIdentity identity = profileService.getIdentity(employeeId);
        return toIdentityResponse(identity);
    }

    @PutMapping("/identity")
    @Operation(summary = "Save employee identity (PAN, Aadhaar, UAN, ESIC, passport)")
    @PreAuthorize("@perm.check('hrms.employee.identity.write')")
    public IdentityResponse saveIdentity(@PathVariable UUID employeeId,
                                          @Valid @RequestBody IdentityRequest req) {
        EmployeeIdentity saved = profileService.saveIdentity(employeeId, req.toEntity(), req.pan(), req.aadhaar(), req.passportNumber());
        return toIdentityResponse(saved);
    }

    // ── Bank Account (PII — requires elevated permission) ─────────────────

    @GetMapping("/bank-accounts")
    @Operation(summary = "List bank accounts for an employee (account number decrypted)")
    @PreAuthorize("@perm.check('hrms.employee.bank.read')")
    public List<BankAccountResponse> getBankAccounts(@PathVariable UUID employeeId) {
        return profileService.getBankAccounts(employeeId).stream()
                .map(this::toBankAccountResponse)
                .toList();
    }

    @PostMapping("/bank-accounts")
    @Operation(summary = "Add a bank account for an employee")
    @PreAuthorize("@perm.check('hrms.employee.bank.write')")
    public ResponseEntity<BankAccountResponse> addBankAccount(@PathVariable UUID employeeId,
                                                               @Valid @RequestBody BankAccountRequest req) {
        EmployeeBankAccount saved = profileService.addBankAccount(employeeId, req.toEntity(), req.accountNumber());
        return ResponseEntity.status(HttpStatus.CREATED).body(toBankAccountResponse(saved));
    }

    @DeleteMapping("/bank-accounts/{accountId}")
    @Operation(summary = "Delete a bank account")
    @PreAuthorize("@perm.check('hrms.employee.bank.write')")
    public ResponseEntity<Void> deleteBankAccount(@PathVariable UUID employeeId, @PathVariable UUID accountId) {
        profileService.deleteBankAccount(accountId);
        return ResponseEntity.noContent().build();
    }

    // ── Education ─────────────────────────────────────────────────────────

    @GetMapping("/education")
    @Operation(summary = "List education records for an employee")
    @PreAuthorize("@perm.check('hrms.employee.profile.read')")
    public List<EmployeeEducation> getEducation(@PathVariable UUID employeeId) {
        return profileService.getEducation(employeeId);
    }

    @PostMapping("/education")
    @Operation(summary = "Add an education record")
    @PreAuthorize("@perm.check('hrms.employee.profile.write')")
    public ResponseEntity<EmployeeEducation> addEducation(@PathVariable UUID employeeId,
                                                           @Valid @RequestBody EmployeeEducation education) {
        return ResponseEntity.status(HttpStatus.CREATED).body(profileService.addEducation(employeeId, education));
    }

    @DeleteMapping("/education/{educationId}")
    @Operation(summary = "Delete an education record")
    @PreAuthorize("@perm.check('hrms.employee.profile.write')")
    public ResponseEntity<Void> deleteEducation(@PathVariable UUID employeeId, @PathVariable UUID educationId) {
        profileService.deleteEducation(educationId);
        return ResponseEntity.noContent().build();
    }

    // ── Experience ───────────────────────────────────────────────────────

    @GetMapping("/experience")
    @Operation(summary = "List work experience records for an employee")
    @PreAuthorize("@perm.check('hrms.employee.profile.read')")
    public List<EmployeeExperience> getExperience(@PathVariable UUID employeeId) {
        return profileService.getExperience(employeeId);
    }

    @PostMapping("/experience")
    @Operation(summary = "Add a work experience record")
    @PreAuthorize("@perm.check('hrms.employee.profile.write')")
    public ResponseEntity<EmployeeExperience> addExperience(@PathVariable UUID employeeId,
                                                             @Valid @RequestBody EmployeeExperience experience) {
        return ResponseEntity.status(HttpStatus.CREATED).body(profileService.addExperience(employeeId, experience));
    }

    @DeleteMapping("/experience/{experienceId}")
    @Operation(summary = "Delete a work experience record")
    @PreAuthorize("@perm.check('hrms.employee.profile.write')")
    public ResponseEntity<Void> deleteExperience(@PathVariable UUID employeeId, @PathVariable UUID experienceId) {
        profileService.deleteExperience(experienceId);
        return ResponseEntity.noContent().build();
    }

    // ── Dependents ───────────────────────────────────────────────────────

    @GetMapping("/dependents")
    @Operation(summary = "List dependents for an employee")
    @PreAuthorize("@perm.check('hrms.employee.profile.read')")
    public List<EmployeeDependent> getDependents(@PathVariable UUID employeeId) {
        return profileService.getDependents(employeeId);
    }

    @PostMapping("/dependents")
    @Operation(summary = "Add a dependent")
    @PreAuthorize("@perm.check('hrms.employee.profile.write')")
    public ResponseEntity<EmployeeDependent> addDependent(@PathVariable UUID employeeId,
                                                           @Valid @RequestBody EmployeeDependent dependent) {
        return ResponseEntity.status(HttpStatus.CREATED).body(profileService.addDependent(employeeId, dependent));
    }

    @DeleteMapping("/dependents/{dependentId}")
    @Operation(summary = "Delete a dependent")
    @PreAuthorize("@perm.check('hrms.employee.profile.write')")
    public ResponseEntity<Void> deleteDependent(@PathVariable UUID employeeId, @PathVariable UUID dependentId) {
        profileService.deleteDependent(dependentId);
        return ResponseEntity.noContent().build();
    }

    // ── Emergency Contacts ────────────────────────────────────────────────

    @GetMapping("/emergency-contacts")
    @Operation(summary = "List emergency contacts for an employee")
    @PreAuthorize("@perm.check('hrms.employee.profile.read')")
    public List<EmergencyContactResponse> getEmergencyContacts(@PathVariable UUID employeeId) {
        return emergencyContactRepo.findByEmployeeId(employeeId).stream()
                .map(this::toContactResponse)
                .toList();
    }

    @PostMapping("/emergency-contacts")
    @Operation(summary = "Add an emergency contact")
    @PreAuthorize("@perm.check('hrms.employee.profile.write')")
    public ResponseEntity<EmergencyContactResponse> addEmergencyContact(@PathVariable UUID employeeId,
                                                                          @Valid @RequestBody EmergencyContactRequest req) {
        EmergencyContact contact = new EmergencyContact();
        contact.setTenantId(TenantContext.getTenantId());
        contact.setEmployeeId(employeeId);
        contact.setName(req.name());
        contact.setRelationship(req.relationship());
        contact.setPhone(req.phone());
        contact.setEmail(req.email());
        contact.setPrimary(req.isPrimary());
        EmergencyContact saved = emergencyContactRepo.save(contact);
        return ResponseEntity.status(HttpStatus.CREATED).body(toContactResponse(saved));
    }

    @DeleteMapping("/emergency-contacts/{contactId}")
    @Operation(summary = "Delete an emergency contact")
    @PreAuthorize("@perm.check('hrms.employee.profile.write')")
    public ResponseEntity<Void> deleteEmergencyContact(@PathVariable UUID employeeId, @PathVariable UUID contactId) {
        emergencyContactRepo.deleteById(contactId);
        return ResponseEntity.noContent().build();
    }

    // ── Mappers ───────────────────────────────────────────────────────────

    private IdentityResponse toIdentityResponse(EmployeeIdentity identity) {
        if (identity == null) return null;
        return new IdentityResponse(
                identity.getId(),
                identity.getEmployeeId(),
                identity.getPanEncrypted() != null ? profileService.decryptPan(identity) : null,
                identity.getAadhaarLast4(),
                identity.getAadhaarEncrypted() != null ? profileService.decryptAadhaar(identity) : null,
                identity.getUan(),
                identity.getEsicNumber(),
                identity.getPassportNumberEncrypted() != null ? profileService.decryptPassport(identity) : null,
                identity.getPassportExpiry()
        );
    }

    private BankAccountResponse toBankAccountResponse(EmployeeBankAccount account) {
        return new BankAccountResponse(
                account.getId(),
                account.getEmployeeId(),
                account.getAccountHolderName(),
                account.getBankName(),
                account.getBranchName(),
                account.getIfscCode(),
                account.getAccountNumberLast4(),
                account.getAccountNumberEncrypted() != null ? profileService.decryptAccountNumber(account) : null,
                account.isPrimary(),
                account.isVerified()
        );
    }

    private EmergencyContactResponse toContactResponse(EmergencyContact contact) {
        return new EmergencyContactResponse(
                contact.getId(),
                contact.getEmployeeId(),
                contact.getName(),
                contact.getRelationship(),
                contact.getPhone(),
                contact.getEmail(),
                contact.isPrimary()
        );
    }

    // ── Request / Response records ────────────────────────────────────────

    public record IdentityRequest(
            String pan,
            String aadhaar,
            String passportNumber,
            LocalDate passportExpiry,
            String uan,
            String esicNumber) {

        public EmployeeIdentity toEntity() {
            EmployeeIdentity e = new EmployeeIdentity();
            if (passportExpiry != null) e.setPassportExpiry(passportExpiry);
            if (uan != null) e.setUan(uan);
            if (esicNumber != null) e.setEsicNumber(esicNumber);
            return e;
        }
    }

    public record IdentityResponse(
            UUID id,
            UUID employeeId,
            String pan,
            String aadhaarLast4,
            String aadhaar,
            String uan,
            String esicNumber,
            String passportNumber,
            LocalDate passportExpiry) {}

    public record BankAccountRequest(
            @NotBlank String accountNumber,
            @NotBlank String ifscCode,
            String bankName,
            String branchName,
            @NotBlank String accountHolderName,
            boolean primary) {

        public EmployeeBankAccount toEntity() {
            EmployeeBankAccount e = new EmployeeBankAccount();
            e.setIfscCode(ifscCode);
            e.setBankName(bankName);
            e.setBranchName(branchName);
            e.setAccountHolderName(accountHolderName);
            e.setPrimary(primary);
            return e;
        }
    }

    public record BankAccountResponse(
            UUID id,
            UUID employeeId,
            String accountHolderName,
            String bankName,
            String branchName,
            String ifscCode,
            String accountNumberLast4,
            String accountNumber,
            boolean primary,
            boolean verified) {}
}
