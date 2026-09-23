package com.hrms.api.auth.canonical;
import com.unifiedtree.auth.dto.AuthDtos;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class AuthLogRedactionTest {
 @Test void debugRepresentationsExcludeCredentialsAndTokens() {
  UUID id=UUID.randomUUID();
  assertFalse(new AuthDtos.LoginRequest(id,"example@example.invalid","test-password").toString().contains("test-password"));
  assertFalse(new AuthDtos.RefreshRequest("test-refresh").toString().contains("test-refresh"));
  String response=new AuthDtos.LoginResponse("test-access","test-refresh",Instant.EPOCH,id,id,id,"example@example.invalid","Example","User",List.of(),List.of()).toString();
  assertFalse(response.contains("test-access"));assertFalse(response.contains("test-refresh"));
 }
}
