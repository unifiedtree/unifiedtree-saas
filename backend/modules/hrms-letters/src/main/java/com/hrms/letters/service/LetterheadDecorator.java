package com.hrms.letters.service;

import java.util.UUID;

/**
 * Adds the workspace's letterhead (its logo and the company name) to the top
 * of a generated letter before it is rendered to PDF. White label: letters
 * carry the customer's own branding, never the vendor's.
 *
 * <p>Implemented in the app layer (it needs the workspace branding store); the
 * letters module works without one, in which case letters render as authored.
 */
public interface LetterheadDecorator {

    /** The letter body with a letterhead in front of it. */
    String decorate(String bodyHtml, UUID tenantId, String companyName);

    /** The name to send letter emails under: the company, else the workspace. */
    String senderName(UUID tenantId, String companyName);
}
