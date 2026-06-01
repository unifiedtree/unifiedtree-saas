package com.hrms.letters.service;

public interface PdfRenderer {
    byte[] render(String htmlContent);
}
