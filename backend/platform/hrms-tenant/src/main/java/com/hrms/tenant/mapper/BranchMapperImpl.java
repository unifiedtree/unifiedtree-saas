package com.hrms.tenant.mapper;

import com.hrms.tenant.dto.BranchRequest;
import com.hrms.tenant.dto.BranchResponse;
import com.hrms.tenant.entity.Branch;
import java.util.UUID;
import javax.annotation.processing.Generated;
import org.springframework.stereotype.Component;

@Generated(
    value = "org.mapstruct.ap.MappingProcessor",
    date = "2026-05-15T12:47:24+0530",
    comments = "version: 1.6.3, compiler: javac, environment: Java 21.0.11 (Eclipse Adoptium)"
)
@Component
public class BranchMapperImpl implements BranchMapper {

    @Override
    public Branch toEntity(BranchRequest request) {
        if ( request == null ) {
            return null;
        }

        Branch branch = new Branch();

        branch.setHeadquarters( request.isHeadquarters() );
        branch.setName( request.name() );
        branch.setCode( request.code() );
        branch.setCompanyId( request.companyId() );
        branch.setAddress( request.address() );
        branch.setCity( request.city() );
        branch.setState( request.state() );
        branch.setCountry( request.country() );
        branch.setPincode( request.pincode() );
        branch.setLatitude( request.latitude() );
        branch.setLongitude( request.longitude() );
        branch.setGeoFenceRadiusMeters( request.geoFenceRadiusMeters() );
        branch.setColorHex( request.colorHex() );
        branch.setIconKey( request.iconKey() );

        branch.setActive( true );

        return branch;
    }

    @Override
    public BranchResponse toResponse(Branch branch) {
        if ( branch == null ) {
            return null;
        }

        boolean isActive = false;
        boolean isHeadquarters = false;
        UUID id = null;
        String name = null;
        String code = null;
        UUID companyId = null;
        String address = null;
        String city = null;
        String state = null;
        String country = null;
        String pincode = null;
        Double latitude = null;
        Double longitude = null;
        int geoFenceRadiusMeters = 0;
        String colorHex = null;
        String iconKey = null;

        isActive = branch.isActive();
        isHeadquarters = branch.isHeadquarters();
        id = branch.getId();
        name = branch.getName();
        code = branch.getCode();
        companyId = branch.getCompanyId();
        address = branch.getAddress();
        city = branch.getCity();
        state = branch.getState();
        country = branch.getCountry();
        pincode = branch.getPincode();
        latitude = branch.getLatitude();
        longitude = branch.getLongitude();
        geoFenceRadiusMeters = branch.getGeoFenceRadiusMeters();
        colorHex = branch.getColorHex();
        iconKey = branch.getIconKey();

        BranchResponse branchResponse = new BranchResponse( id, name, code, companyId, address, city, state, country, pincode, latitude, longitude, geoFenceRadiusMeters, isHeadquarters, isActive, colorHex, iconKey );

        return branchResponse;
    }

    @Override
    public void updateEntity(BranchRequest request, Branch branch) {
        if ( request == null ) {
            return;
        }

        branch.setHeadquarters( request.isHeadquarters() );
        branch.setName( request.name() );
        branch.setCode( request.code() );
        branch.setCompanyId( request.companyId() );
        branch.setAddress( request.address() );
        branch.setCity( request.city() );
        branch.setState( request.state() );
        branch.setCountry( request.country() );
        branch.setPincode( request.pincode() );
        branch.setLatitude( request.latitude() );
        branch.setLongitude( request.longitude() );
        branch.setGeoFenceRadiusMeters( request.geoFenceRadiusMeters() );
        branch.setColorHex( request.colorHex() );
        branch.setIconKey( request.iconKey() );
    }
}
