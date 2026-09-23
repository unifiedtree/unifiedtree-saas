package com.hrms.api.compliance;

import org.springframework.http.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.*;

@RestController
public class InspectionDocumentController {
    private final InspectionDocuments documents;
    private final InspectorAccessService access;
    public InspectionDocumentController(InspectionDocuments documents,InspectorAccessService access){this.documents=documents;this.access=access;}
    @GetMapping("/v1/compliance/inspector-sessions/{sessionId}/documents")
    @PreAuthorize("hasAnyAuthority('hrms.compliance.inspector.read','hrms.compliance.read')")
    public List<InspectionDocuments.Item> list(@PathVariable UUID sessionId){return documents.list(sessionId);}
    @PostMapping(value="/v1/compliance/inspector-sessions/{sessionId}/documents",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyAuthority('hrms.compliance.inspector.write','hrms.compliance.write')")
    @ResponseStatus(HttpStatus.CREATED)
    public InspectionDocuments.Item upload(@PathVariable UUID sessionId,@RequestParam String title,@RequestPart MultipartFile file)throws java.io.IOException{
        if(file.getSize()>5242880)throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST,"Maximum document size is 5 MB");
        return documents.upload(sessionId,title,file.getBytes());
    }
    @DeleteMapping("/v1/compliance/inspector-sessions/{sessionId}/documents/{id}")
    @PreAuthorize("hasAnyAuthority('hrms.compliance.inspector.write','hrms.compliance.write')")
    public void remove(@PathVariable UUID sessionId,@PathVariable UUID id){documents.remove(sessionId,id);}
    public record Download(String token,UUID id){}
    @PostMapping("/v1/public/inspector-view/document")
    public ResponseEntity<byte[]> download(@RequestBody Download input){
        UUID[] scope=access.verify(input.token());
        UUID previous=com.unifiedtree.security.tenant.TenantContext.getTenantId(), legacy=com.hrms.core.tenant.TenantContext.getTenantId();
        try {
            com.unifiedtree.security.tenant.TenantContext.setTenantId(scope[0]);com.hrms.core.tenant.TenantContext.setTenantId(scope[0]);
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF).cacheControl(CacheControl.noStore())
                    .header("Content-Disposition","attachment; filename=\"inspection-"+input.id()+".pdf\"")
                    .body(documents.download(scope[1],input.id()));
        } finally {com.unifiedtree.security.tenant.TenantContext.setTenantId(previous);com.hrms.core.tenant.TenantContext.setTenantId(legacy);}
    }
}
