package com.hrms.letters.dto;

public record SendLetterRequest(
        String toEmail,
        String ccEmail
) {}
