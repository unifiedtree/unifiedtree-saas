package com.hrms.api.workforce;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** BW-92: drafts never keep PAN, Aadhaar, passport, UAN, ESI or bank details, whatever the field is called. */
class EmployeeDraftPayloadTest {

    private final ObjectMapper json = new ObjectMapper();

    private ObjectNode parse(String text) throws Exception {
        return (ObjectNode) json.readTree(text);
    }

    @Test
    void stripsIdentityAndBankFieldsAndKeepsTheRest() throws Exception {
        ObjectNode form = parse("""
                {"firstName":"Asha","lastName":"Rao","email":"asha@example.com","phone":"9876543210",
                 "departmentId":"d1","dateOfJoining":"2026-10-01","salaryFrequency":"MONTHLY","monthlySalary":50000,
                 "panNumber":"ABCDE1234F","aadhaarNumber":"123412341234","passportNumber":"Z1234567",
                 "uanNumber":"100200300400","esiNumber":"1234567890",
                 "bankName":"HDFC","bankAccountNumber":"123456789012","bankIfsc":"HDFC0001234","bankBranchName":"MG Road"}
                """);
        var removed = EmployeeDraftPayload.strip(form);
        assertThat(removed).containsExactlyInAnyOrder("panNumber", "aadhaarNumber", "passportNumber", "uanNumber",
                "esiNumber", "bankName", "bankAccountNumber", "bankIfsc", "bankBranchName");
        assertThat(form.fieldNames()).toIterable().containsExactlyInAnyOrder("firstName", "lastName", "email", "phone",
                "departmentId", "dateOfJoining", "salaryFrequency", "monthlySalary");
    }

    @Test
    void everySpellingAndEveryDepth() throws Exception {
        ObjectNode form = parse("""
                {"PAN":"x","pan_number":"x","Aadhar":"x","UAN":"x","pfUan":"x","ESIC":"x","ifsc_code":"x",
                 "account_number":"x","bank":{"name":"keep","accountNumber":"x","IFSC":"x"},
                 "people":[{"firstName":"A","pan":"x"},{"aadhaar_number":"x"}],
                 "planName":"keep","company":"keep"}
                """);
        var removed = EmployeeDraftPayload.strip(form);
        assertThat(removed).contains("PAN", "pan_number", "Aadhar", "UAN", "pfUan", "ESIC", "ifsc_code", "account_number",
                "bank.accountNumber", "bank.IFSC", "people[0].pan", "people[1].aadhaar_number");
        String text = form.toString();
        assertThat(text).doesNotContain("\"x\"");
        assertThat(text).contains("\"planName\":\"keep\"", "\"company\":\"keep\"", "\"name\":\"keep\"", "\"firstName\":\"A\"");
    }

    @Test
    void nothingToStrip() throws Exception {
        ObjectNode form = parse("{\"firstName\":\"Asha\"}");
        assertThat(EmployeeDraftPayload.strip(form)).isEmpty();
        assertThat(form.toString()).isEqualTo("{\"firstName\":\"Asha\"}");
    }

    @Test
    void displayNameIsTheNameElseTheEmail() throws Exception {
        assertThat(EmployeeDraftPayload.displayName(parse("{\"firstName\":\" Asha \",\"lastName\":\"Rao\"}"))).isEqualTo("Asha Rao");
        assertThat(EmployeeDraftPayload.displayName(parse("{\"lastName\":\"Rao\"}"))).isEqualTo("Rao");
        assertThat(EmployeeDraftPayload.displayName(parse("{\"email\":\"a@b.c\",\"firstName\":\"  \"}"))).isEqualTo("a@b.c");
        assertThat(EmployeeDraftPayload.displayName(parse("{}"))).isNull();
    }
}
