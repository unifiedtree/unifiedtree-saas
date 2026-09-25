package com.hrms.api.expense;

import com.unifiedtree.settings.branding.DocumentStorage;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Receipt upload validation and the "only your own receipts" rule on claims. */
class ExpenseReceiptsTest {

    private final DocumentStorage storage = mock(DocumentStorage.class);
    private final ExpenseReceipts receipts = new ExpenseReceipts(storage);
    private final UUID tenant = UUID.randomUUID(), employee = UUID.randomUUID(), other = UUID.randomUUID();
    private static final byte[] PDF = "%PDF-1.7 receipt".getBytes(StandardCharsets.US_ASCII);

    @Test void storesUnderTheClaimantsPrefixAndReturnsAKeyTheyOwn() throws Exception {
        when(storage.isConfigured()).thenReturn(true);
        ExpenseReceipts.Stored stored = receipts.store(tenant, employee,
                new MockMultipartFile("file", "C:\\fakepath\\taxi.pdf", "application/pdf", PDF));
        verify(storage).put(startsWith("expense-receipts/" + tenant + "/" + employee + "/"), eq(PDF), eq("application/pdf"));
        assertTrue(stored.receiptUrl().startsWith("r2://expense-receipts/" + tenant + "/" + employee + "/"));
        assertTrue(stored.receiptUrl().endsWith(".pdf"));
        assertEquals("taxi.pdf", stored.fileName());
        assertTrue(ExpenseReceipts.isOwnedBy(stored.receiptUrl(), tenant, employee));
        assertFalse(ExpenseReceipts.isOwnedBy(stored.receiptUrl(), tenant, other), "a colleague can't reuse it");
        assertFalse(ExpenseReceipts.isOwnedBy(stored.receiptUrl(), UUID.randomUUID(), employee), "another workspace can't reuse it");
    }

    @Test void refusesContentThatIsNotAPdfOrImage() {
        when(storage.isConfigured()).thenReturn(true);
        ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> receipts.store(tenant, employee,
                new MockMultipartFile("file", "receipt.pdf", "application/pdf", "<script>".getBytes())));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
        verify(storage, never()).put(any(), any(), any());
    }

    @Test void refusesAnOversizedReceipt() {
        when(storage.isConfigured()).thenReturn(true);
        byte[] big = new byte[(int) ExpenseReceipts.MAX_BYTES + 1];
        System.arraycopy(PDF, 0, big, 0, PDF.length);
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> receipts.store(tenant, employee, new MockMultipartFile("file", "big.pdf", "application/pdf", big)));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
        assertTrue(e.getReason().contains("10 MB"));
    }

    @Test void saysSoWhenStorageIsNotSetUp() {
        when(storage.isConfigured()).thenReturn(false);
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> receipts.store(tenant, employee, new MockMultipartFile("file", "r.pdf", "application/pdf", PDF)));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatusCode());
    }

    @Test void pastedLinksAndTraversalAreNotReceipts() {
        assertFalse(ExpenseReceipts.isOwnedBy("https://evil.example/receipt.pdf", tenant, employee));
        assertFalse(ExpenseReceipts.isOwnedBy("r2://employee-documents/" + tenant + "/" + UUID.randomUUID() + ".pdf", tenant, employee));
        assertFalse(ExpenseReceipts.isOwnedBy("r2://expense-receipts/" + tenant + "/" + employee + "/../x.pdf", tenant, employee));
        assertFalse(ExpenseReceipts.isOwnedBy(null, tenant, employee));
    }

    @Test void signsOnlyThisWorkspacesReceipts() {
        when(storage.isConfigured()).thenReturn(true);
        String mine = "r2://expense-receipts/" + tenant + "/" + employee + "/" + UUID.randomUUID() + ".jpg";
        String theirs = "r2://expense-receipts/" + UUID.randomUUID() + "/" + employee + "/" + UUID.randomUUID() + ".jpg";
        when(storage.urlFor(mine.substring(5))).thenReturn("https://signed.example/1");
        assertEquals("https://signed.example/1", receipts.signedUrl(mine, tenant));
        assertNull(receipts.signedUrl(theirs, tenant));
        assertNull(receipts.signedUrl(null, tenant));
        when(storage.isConfigured()).thenReturn(false);
        assertNull(receipts.signedUrl(mine, tenant), "no dead links when storage isn't set up");
    }

    @Test void detectsRealContentTypes() {
        assertEquals("application/pdf", ExpenseReceipts.detectContentType(PDF));
        assertEquals("image/png", ExpenseReceipts.detectContentType(new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10}));
        assertEquals("image/jpeg", ExpenseReceipts.detectContentType(new byte[] {(byte) 255, (byte) 216, (byte) 255}));
        assertThrows(ResponseStatusException.class, () -> ExpenseReceipts.detectContentType(new byte[0]));
    }
}
