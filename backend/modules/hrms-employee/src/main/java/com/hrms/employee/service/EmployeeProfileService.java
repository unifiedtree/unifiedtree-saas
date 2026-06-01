package com.hrms.employee.service;

import com.hrms.core.crypto.FieldEncryptor;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.EmployeeAddress;
import com.hrms.employee.entity.EmployeeBankAccount;
import com.hrms.employee.entity.EmployeeDependent;
import com.hrms.employee.entity.EmployeeEducation;
import com.hrms.employee.entity.EmployeeExperience;
import com.hrms.employee.entity.EmployeeIdentity;
import com.hrms.employee.repository.EmployeeAddressRepository;
import com.hrms.employee.repository.EmployeeBankAccountRepository;
import com.hrms.employee.repository.EmployeeDependentRepository;
import com.hrms.employee.repository.EmployeeEducationRepository;
import com.hrms.employee.repository.EmployeeExperienceRepository;
import com.hrms.employee.repository.EmployeeIdentityRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class EmployeeProfileService {

    private final EmployeeAddressRepository addressRepo;
    private final EmployeeIdentityRepository identityRepo;
    private final EmployeeBankAccountRepository bankRepo;
    private final EmployeeEducationRepository educationRepo;
    private final EmployeeExperienceRepository experienceRepo;
    private final EmployeeDependentRepository dependentRepo;
    private final FieldEncryptor encryptor;

    public EmployeeProfileService(
            EmployeeAddressRepository addressRepo,
            EmployeeIdentityRepository identityRepo,
            EmployeeBankAccountRepository bankRepo,
            EmployeeEducationRepository educationRepo,
            EmployeeExperienceRepository experienceRepo,
            EmployeeDependentRepository dependentRepo,
            FieldEncryptor encryptor) {
        this.addressRepo = addressRepo;
        this.identityRepo = identityRepo;
        this.bankRepo = bankRepo;
        this.educationRepo = educationRepo;
        this.experienceRepo = experienceRepo;
        this.dependentRepo = dependentRepo;
        this.encryptor = encryptor;
    }

    // ── Address ───────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<EmployeeAddress> getAddresses(UUID employeeId) {
        return addressRepo.findByEmployeeId(employeeId);
    }

    @Transactional
    public EmployeeAddress saveAddress(UUID employeeId, EmployeeAddress address) {
        address.setEmployeeId(employeeId);
        address.setTenantId(TenantContext.getTenantId());
        return addressRepo.save(address);
    }

    @Transactional
    public void deleteAddress(UUID addressId) {
        addressRepo.deleteById(addressId);
    }

    // ── Identity (PII) ───────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public EmployeeIdentity getIdentity(UUID employeeId) {
        return identityRepo.findByEmployeeId(employeeId).orElse(null);
    }

    @Transactional
    public EmployeeIdentity saveIdentity(UUID employeeId, EmployeeIdentity req, String pan, String aadhaar, String passport) {
        EmployeeIdentity identity = identityRepo.findByEmployeeId(employeeId)
                .orElseGet(() -> {
                    EmployeeIdentity n = new EmployeeIdentity();
                    n.setEmployeeId(employeeId);
                    n.setTenantId(TenantContext.getTenantId());
                    return n;
                });

        if (pan != null) {
            identity.setPanEncrypted(encryptor.encrypt(pan));
        }
        if (aadhaar != null) {
            identity.setAadhaarEncrypted(encryptor.encrypt(aadhaar));
            identity.setAadhaarLast4(aadhaar.length() >= 4 ? aadhaar.substring(aadhaar.length() - 4) : aadhaar);
        }
        if (passport != null) {
            identity.setPassportNumberEncrypted(encryptor.encrypt(passport));
        }
        if (req.getPassportExpiry() != null) {
            identity.setPassportExpiry(req.getPassportExpiry());
        }
        if (req.getUan() != null) identity.setUan(req.getUan());
        if (req.getEsicNumber() != null) identity.setEsicNumber(req.getEsicNumber());

        return identityRepo.save(identity);
    }

    public String decryptPan(EmployeeIdentity identity) {
        return encryptor.decrypt(identity.getPanEncrypted());
    }

    public String decryptAadhaar(EmployeeIdentity identity) {
        return encryptor.decrypt(identity.getAadhaarEncrypted());
    }

    public String decryptPassport(EmployeeIdentity identity) {
        return encryptor.decrypt(identity.getPassportNumberEncrypted());
    }

    // ── Bank Account (PII) ───────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<EmployeeBankAccount> getBankAccounts(UUID employeeId) {
        return bankRepo.findByEmployeeId(employeeId);
    }

    @Transactional
    public EmployeeBankAccount addBankAccount(UUID employeeId, EmployeeBankAccount req, String accountNumber) {
        if (req.isPrimary()) {
            bankRepo.findByEmployeeId(employeeId).forEach(existing -> {
                if (existing.isPrimary()) {
                    existing.setPrimary(false);
                    bankRepo.save(existing);
                }
            });
        }
        req.setEmployeeId(employeeId);
        req.setTenantId(TenantContext.getTenantId());
        req.setAccountNumberEncrypted(encryptor.encrypt(accountNumber));
        if (accountNumber.length() >= 4) {
            req.setAccountNumberLast4(accountNumber.substring(accountNumber.length() - 4));
        }
        return bankRepo.save(req);
    }

    @Transactional
    public void deleteBankAccount(UUID bankAccountId) {
        bankRepo.deleteById(bankAccountId);
    }

    public String decryptAccountNumber(EmployeeBankAccount account) {
        return encryptor.decrypt(account.getAccountNumberEncrypted());
    }

    // ── Education ─────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<EmployeeEducation> getEducation(UUID employeeId) {
        return educationRepo.findByEmployeeIdOrderByEndYearDesc(employeeId);
    }

    @Transactional
    public EmployeeEducation addEducation(UUID employeeId, EmployeeEducation education) {
        education.setEmployeeId(employeeId);
        education.setTenantId(TenantContext.getTenantId());
        return educationRepo.save(education);
    }

    @Transactional
    public void deleteEducation(UUID educationId) {
        educationRepo.deleteById(educationId);
    }

    // ── Experience ───────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<EmployeeExperience> getExperience(UUID employeeId) {
        return experienceRepo.findByEmployeeIdOrderByStartDateDesc(employeeId);
    }

    @Transactional
    public EmployeeExperience addExperience(UUID employeeId, EmployeeExperience experience) {
        experience.setEmployeeId(employeeId);
        experience.setTenantId(TenantContext.getTenantId());
        return experienceRepo.save(experience);
    }

    @Transactional
    public void deleteExperience(UUID experienceId) {
        experienceRepo.deleteById(experienceId);
    }

    // ── Dependents ───────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<EmployeeDependent> getDependents(UUID employeeId) {
        return dependentRepo.findByEmployeeId(employeeId);
    }

    @Transactional
    public EmployeeDependent addDependent(UUID employeeId, EmployeeDependent dependent) {
        dependent.setEmployeeId(employeeId);
        dependent.setTenantId(TenantContext.getTenantId());
        return dependentRepo.save(dependent);
    }

    @Transactional
    public void deleteDependent(UUID dependentId) {
        dependentRepo.deleteById(dependentId);
    }
}
