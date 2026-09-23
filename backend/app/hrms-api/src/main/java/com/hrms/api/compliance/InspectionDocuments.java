package com.hrms.api.compliance;

import com.hrms.compliance.repository.InspectorSessionRepository;
import com.hrms.compliance.enums.InspectorSessionStatus;
import com.hrms.core.tenant.TenantContext;
import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.settings.branding.DocumentStorage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

@Service
public class InspectionDocuments {
    private final JdbcTemplate jdbc;
    private final InspectorSessionRepository sessions;
    private final DocumentStorage storage;
    private final Path localRoot;
    public InspectionDocuments(JdbcTemplate jdbc, InspectorSessionRepository sessions, DocumentStorage storage,
            @Value("${unifiedtree.inspection.local-path:}") String localPath) {
        this.jdbc=jdbc; this.sessions=sessions; this.storage=storage;
        this.localRoot=localPath.isBlank()?null:Path.of(localPath).toAbsolutePath().normalize();
    }
    private void active(UUID sessionId) {
        var session=sessions.findById(sessionId).orElseThrow(() -> new BusinessRuleException("Inspection not found", "INSPECTION_NOT_FOUND"));
        if(!session.getTenantId().equals(TenantContext.getTenantId()) || session.getStatus()!=InspectorSessionStatus.ACTIVE || !session.getExpiresAt().isAfter(Instant.now()))
            throw new BusinessRuleException("Inspection access is expired or revoked", "INSPECTION_ACCESS_DENIED");
    }
    public record Item(UUID id,String title,long sizeBytes) {}
    @Transactional(readOnly=true)
    public List<Item> list(UUID sessionId) {
        active(sessionId);
        return jdbc.query("SELECT id,title,size_bytes FROM compliance_mgmt.inspection_documents WHERE tenant_id=? AND session_id=? ORDER BY created_at,id",
                (r,n)->new Item(r.getObject(1,UUID.class),r.getString(2),r.getLong(3)),TenantContext.getTenantId(),sessionId);
    }
    private String key(UUID id) { return "inspection-documents/"+TenantContext.getTenantId()+"/"+id+".pdf"; }
    private Path file(UUID id) {
        if(localRoot==null) throw new IllegalStateException("Local inspection storage is not configured");
        return localRoot.resolve(TenantContext.getTenantId().toString()).resolve(id+".pdf");
    }
    @Transactional
    public Item upload(UUID sessionId,String title,byte[] bytes) {
        active(sessionId);
        if(title==null||title.isBlank()||title.length()>200)throw new BusinessRuleException("Enter a document title of at most 200 characters","DOCUMENT_TITLE_INVALID");
        if(bytes.length<5||bytes.length>5242880||bytes[0]!='%'||bytes[1]!='P'||bytes[2]!='D'||bytes[3]!='F'||bytes[4]!='-')
            throw new BusinessRuleException("Choose a PDF of at most 5 MB","DOCUMENT_FILE_INVALID");
        UUID id=UUID.randomUUID(); String kind=localRoot!=null?"LOCAL":"R2";
        if(kind.equals("R2")&&!storage.isConfigured())throw new BusinessRuleException("Private document storage is not configured","DOCUMENT_STORAGE_UNAVAILABLE");
        try {
            if(kind.equals("LOCAL")) { Files.createDirectories(file(id).getParent()); Files.write(file(id),bytes,StandardOpenOption.CREATE_NEW); }
            else storage.put(key(id),bytes,"application/pdf");
            jdbc.update("INSERT INTO compliance_mgmt.inspection_documents(id,tenant_id,session_id,title,storage_kind,size_bytes) VALUES(?,?,?,?,?,?)",
                    id,TenantContext.getTenantId(),sessionId,title.trim(),kind,bytes.length);
            return new Item(id,title.trim(),bytes.length);
        } catch(Exception error) {
            if(kind.equals("LOCAL")) { try { Files.deleteIfExists(file(id)); } catch(Exception ignored) {} }
            else storage.deleteQuietly(key(id));
            throw new IllegalStateException("Document could not be stored",error);
        }
    }
    @Transactional(readOnly=true)
    public byte[] download(UUID sessionId,UUID id) {
        active(sessionId);
        var kinds=jdbc.queryForList("SELECT storage_kind FROM compliance_mgmt.inspection_documents WHERE id=? AND tenant_id=? AND session_id=?",String.class,id,TenantContext.getTenantId(),sessionId);
        if(kinds.isEmpty())throw new BusinessRuleException("Document is not shared with this inspection","INSPECTION_DOCUMENT_DENIED");
        try { return kinds.getFirst().equals("LOCAL")?Files.readAllBytes(file(id)):storage.read(key(id)); }
        catch(java.io.IOException e){throw new IllegalStateException("Stored document could not be read",e);}
    }
    @Transactional
    public void remove(UUID sessionId,UUID id) {
        active(sessionId);
        // Unsharing is durable and immediate; retain the private object for audit/recovery.
        jdbc.update("DELETE FROM compliance_mgmt.inspection_documents WHERE id=? AND tenant_id=? AND session_id=?",id,TenantContext.getTenantId(),sessionId);
    }
}
