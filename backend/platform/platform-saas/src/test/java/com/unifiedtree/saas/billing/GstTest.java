package com.unifiedtree.saas.billing;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/** GSTIN shape, state codes and the CGST + SGST / IGST split used when an invoice is issued. */
class GstTest {

    @Test
    void aWellFormedGstinIsValidAndGivesItsState() {
        assertThat(Gst.validGstin("29ABCDE1234F1Z5")).isTrue();
        assertThat(Gst.stateOfGstin("36AAACU1234B1ZQ")).isEqualTo("36");
    }

    @Test
    void aMalformedGstinNeverGivesAState() {
        // the old loose check (2 digits + 13 alphanumerics) accepted all of these
        for (String bad : new String[] {"29ABCDE1234F1X5", "29ABCDE12345125", "00ABCDE1234F1Z5", "29abcde1234f1z5",
                "29ABCDE1234F1Z", " "}) {
            assertThat(Gst.validGstin(bad)).as(bad).isFalse();
            assertThat(Gst.stateOfGstin(bad)).as(bad).isNull();
        }
        assertThat(Gst.validGstin(null)).isFalse();
    }

    @Test
    void stateNamesAsTypedMapToTheirCodes() {
        assertThat(Gst.stateCode("Telangana")).isEqualTo("36");
        assertThat(Gst.stateCode("tamil nadu")).isEqualTo("33");
        assertThat(Gst.stateCode("Andhra Pradesh")).isEqualTo("37");
        assertThat(Gst.stateCode("NCT of Delhi")).isEqualTo("07");
        assertThat(Gst.stateCode("Jammu & Kashmir")).isEqualTo("01");
        assertThat(Gst.stateCode("29")).isEqualTo("29");
        assertThat(Gst.stateCode("Atlantis")).isNull();
        assertThat(Gst.stateCode("00")).isNull();
    }

    @Test
    void insideOneStateTheTaxIsCgstPlusSgst() {
        BigDecimal[] s = Gst.split(new BigDecimal("7.49"), true);
        assertThat(s[0]).isEqualByComparingTo("3.75");
        assertThat(s[1]).isEqualByComparingTo("3.74");
        assertThat(s[2]).isEqualByComparingTo("0");
        assertThat(s[0].add(s[1])).isEqualByComparingTo("7.49");
    }

    @Test
    void acrossStatesTheTaxIsIgst() {
        BigDecimal[] s = Gst.split(new BigDecimal("7.48"), false);
        assertThat(s[0]).isEqualByComparingTo("0");
        assertThat(s[1]).isEqualByComparingTo("0");
        assertThat(s[2]).isEqualByComparingTo("7.48");
    }
}
