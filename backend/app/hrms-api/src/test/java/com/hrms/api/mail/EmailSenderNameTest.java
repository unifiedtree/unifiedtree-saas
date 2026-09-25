package com.hrms.api.mail;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** White label: workspace emails carry the workspace's name on the From line. */
class EmailSenderNameTest {

    @Test void aWorkspaceNameReplacesThePlatformDefault() {
        EmailMessage m = EmailMessage.simple("a@b.c", "Hi", "<p>x</p>").withFromName("Acme Works");
        assertEquals("Acme Works", m.senderName("Platform Default"));
        assertEquals("Platform Default", EmailMessage.simple("a@b.c", "Hi", "x").senderName("Platform Default"));
    }

    @Test void headerInjectionAndOddCharactersAreStripped() {
        EmailMessage m = EmailMessage.simple("a@b.c", "Hi", "x").withFromName("Acme\r\nBcc: evil@x.y \"<Works>\"");
        String name = m.senderName("d");
        assertFalse(name.contains("\n") || name.contains("\r") || name.contains("\"") || name.contains("<"), name);
        assertTrue(name.startsWith("Acme"));
    }

    @Test void blankAndOverlongNamesAreHandled() {
        assertEquals("d", EmailMessage.simple("a@b.c", "s", "x").withFromName("   ").senderName("d"));
        String longName = "A".repeat(120);
        assertEquals(70, EmailMessage.simple("a@b.c", "s", "x").withFromName(longName).senderName("d").length());
    }

    @Test void theOldConstructorsStillWorkAndKeepEveryField() {
        var att = List.of(new EmailMessage.Attachment("f.pdf", "application/pdf", new byte[]{1}));
        EmailMessage m = new EmailMessage("a@b.c", "A", "S", "<p/>", null, List.of(), att);
        assertNull(m.fromName());
        EmailMessage named = m.withFromName("Acme");
        assertEquals(att, named.attachments());
        assertEquals("S", named.subject());
        assertEquals("Acme", named.fromName());
    }
}
